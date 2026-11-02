"""
Subscription lifecycle: checkout, verification, plan changes, cancellation and recovery.

Local subscription state is only ever copied from Razorpay (a webhook, or a response to a
server-side API call); nothing the browser sends changes it except a checkout signature, which
only marks the checkout as verified. Every action runs under the user's BillingLock, so one user's
billing requests are applied one at a time, and a slow Razorpay call holds up nothing else.

Policies (see README "Plans and billing"):
- Upgrades (to a higher tier) apply now: Razorpay moves the subscription to the new plan straight
  away and bills it by its own rules; no proration is calculated here. Razorpay can't do that for
  UPI Autopay or eMandate, so those buy a replacement subscription instead: once it's paid, the old
  one is cancelled and its unused days refunded (see "Upgrades that replace the subscription").
- Downgrades and monthly/yearly switches apply at the end of the current cycle; paid access to
  the current plan lasts until then.
- Cancelling at period end keeps access until the paid period ends; cancelling now ends it now.
  Razorpay can't undo a cancellation, so "resubscribing" before the period ends creates a new
  subscription that starts billing when the current period ends.
- Money-back window: cancelling now within BILLING_REFUND_DAYS of a subscription's first payment
  refunds what was paid for it, in full, once per user (refund_offer). Otherwise nothing is refunded.
- A user has at most one subscription that can be paid: a new checkout is refused while another
  is running, scheduled, or waiting for a failed payment or a resume, and any earlier checkout
  that was never completed is cancelled at Razorpay before a new one is created.
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import get_profile

from . import entitlements, razorpay, tiers
from .models import (
    OPEN_STATUSES,
    BillingLock,
    PaymentTransaction,
    ReplacementStatus,
    SubscriptionPlan,
    SubscriptionStatus,
    TERMINAL_STATUSES,
    UserSubscription,
)
from .notifications import notify

logger = logging.getLogger(__name__)

# How long a checkout's payment link works. Razorpay expires it after this (expire_by), and
# reconcile_subscriptions cancels anything older that's still unpaid.
CHECKOUT_EXPIRY = timedelta(days=1)

# Payment methods Razorpay can't move to another plan (update returns an error for them).
NO_PLAN_CHANGE_METHODS = {"upi", "emandate", "nach"}


class BillingError(Exception):
    def __init__(self, message, status=400, code="billing_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def _from_razorpay(exc):
    """A Razorpay error as a BillingError: its own 4xx are the request's fault (409), the rest are ours (502)."""
    status = 409 if exc.status and 400 <= exc.status < 500 else 502
    return BillingError(exc.description, status=status, code="payment_provider_error")


def ts(value):
    """A Razorpay Unix timestamp as an aware datetime (None stays None)."""
    if value in (None, "", 0):
        return None
    return datetime.fromtimestamp(int(value), tz=dt_timezone.utc)


def _lock_user(user):
    BillingLock.objects.get_or_create(user=user)
    BillingLock.objects.select_for_update().get(user=user)


def available_plan(code):
    """
    A plan that can be bought now. A tier with nowhere to send its AI jobs (no paid-tier Gemini key,
    see entitlements.ai_route) isn't sold: it would get the rule-based engine, not what it advertises.
    """
    plan = SubscriptionPlan.objects.filter(code=code, is_active=True).exclude(razorpay_plan_id="").first()
    if plan is None or not entitlements.ai_ready(plan.tier):
        raise BillingError("That plan isn't available.", code="plan_unavailable")
    return plan


# ---------------------------------------------------------------------------
# Applying Razorpay state
# ---------------------------------------------------------------------------

def apply_snapshot(sub, entity, event_time=None):
    """
    Copies a Razorpay subscription entity onto `sub` and saves it. A snapshot older than the
    newest one applied is skipped (webhooks arrive out of order), and a subscription that has
    ended never comes back. Returns True if it was applied.
    """
    if event_time and sub.last_event_at and event_time < sub.last_event_at:
        return False
    status = entity.get("status")
    if sub.status in TERMINAL_STATUSES and status != sub.status and not _paid_after_expiry(sub, status):
        return False
    before = sub.status

    if status in SubscriptionStatus.values:
        sub.status = status
    sub.razorpay_customer_id = entity.get("customer_id") or sub.razorpay_customer_id
    sub.short_url = entity.get("short_url") or sub.short_url
    for field, key in (("start_at", "start_at"), ("current_start", "current_start"), ("current_end", "current_end"),
                       ("next_charge_at", "charge_at"), ("ended_at", "ended_at")):
        if key in entity:
            setattr(sub, field, ts(entity[key]))

    plan = SubscriptionPlan.objects.filter(razorpay_plan_id=entity.get("plan_id") or "-").first()
    if plan is not None and plan.id != sub.plan_id:
        sub.plan = plan
        sub.interval = plan.interval
    if entity.get("has_scheduled_changes"):
        sub.scheduled_change_at = ts(entity.get("change_scheduled_at")) or sub.scheduled_change_at
    elif "has_scheduled_changes" in entity or sub.plan_id == sub.scheduled_plan_id:
        sub.scheduled_plan = None
        sub.scheduled_change_at = None

    if sub.status == SubscriptionStatus.CANCELLED and sub.ended_at is None:
        sub.ended_at = event_time or timezone.now()
    if event_time:
        sub.last_event_at = max(event_time, sub.last_event_at) if sub.last_event_at else event_time
    # An upgrade's subscription is paid: the one it replaces is cancelled and credited next. Also
    # one given up on as abandoned that Razorpay says was paid after all.
    if sub.replaces_id and sub.status == SubscriptionStatus.ACTIVE and sub.replacement_status in (
        ReplacementStatus.AWAITING_PAYMENT, ReplacementStatus.ABANDONED,
    ):
        _begin_finishing(sub)
    sub.save()
    if before != sub.status:
        logger.info("Subscription %s: %s -> %s", sub.razorpay_subscription_id, before, sub.status)
    return True


def _paid_after_expiry(sub, status):
    """
    A checkout this app gave up on (EXPIRED) that Razorpay says was paid after all. Razorpay's state
    wins, so the user gets what they're charged for.
    """
    return sub.status == SubscriptionStatus.EXPIRED and status in OPEN_STATUSES


# Payments only move forward: a late "authorized" can't undo "captured".
_PAYMENT_ORDER = ["created", "authorized", "failed", "captured", "refunded"]


def apply_fresh(sub, entity):
    """
    Applies a subscription Razorpay just returned to a server-side call. Nothing applied before can
    be newer, even an event stamped a little ahead of this server's clock, so it always applies.
    """
    now = timezone.now()
    return apply_snapshot(sub, entity, max(now, sub.last_event_at) if sub.last_event_at else now)


def record_payment(sub, entity, event_time=None):
    """Creates or updates the PaymentTransaction for a Razorpay payment entity. One row per payment ID."""
    status = entity.get("status")
    if status not in PaymentTransaction.Status.values:
        status = PaymentTransaction.Status.CREATED
    card = entity.get("card") if isinstance(entity.get("card"), dict) else {}
    fields = {
        "user_id": sub.user_id,
        "subscription": sub,
        "razorpay_order_id": entity.get("order_id") or "",
        "razorpay_invoice_id": entity.get("invoice_id") or "",
        "amount_paise": int(entity.get("amount") or 0),
        "currency": entity.get("currency") or "INR",
        "method": (entity.get("method") or "")[:20],
        "method_detail": (card.get("network") or entity.get("bank") or entity.get("wallet") or "")[:40],
        "failure_reason": (entity.get("error_description") or "")[:300],
    }
    try:
        with transaction.atomic():
            payment, created = PaymentTransaction.objects.select_for_update().get_or_create(
                razorpay_payment_id=entity["id"], defaults={**fields, "status": status}
            )
    except IntegrityError:  # created by a concurrent delivery of another event for the same payment
        payment, created = PaymentTransaction.objects.select_for_update().get(razorpay_payment_id=entity["id"]), False
    if not created:
        if _PAYMENT_ORDER.index(status) < _PAYMENT_ORDER.index(payment.status):
            return payment
        for name, value in fields.items():
            if value or name in ("user_id", "subscription"):
                setattr(payment, name, value)
        payment.status = status
    if payment.status == PaymentTransaction.Status.CAPTURED and payment.paid_at is None:
        payment.paid_at = event_time or ts(entity.get("created_at")) or timezone.now()
    payment.save()
    return payment


def reconcile(sub):
    """Fetches the subscription from Razorpay and applies it, for when webhooks were missed."""
    entity = razorpay.fetch_subscription(sub.razorpay_subscription_id)
    with transaction.atomic():
        sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
        apply_fresh(sub, entity)
    return sub


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------

@dataclass
class RefundOffer:
    payments: list
    amount_paise: int
    currency: str
    until: datetime


def refund_offer(user, sub):
    """
    What cancelling `sub` now would refund, or None. Only an active subscription whose first payment
    was less than BILLING_REFUND_DAYS ago qualifies, and only for a user never refunded before. It
    covers every payment on it so far (an upgrade adds one).

    Not once it's set to end at period end: that choice is final. Whether Razorpay lets it be
    cancelled now as well is unconfirmed, and a plan bought to follow it would be left waiting.
    """
    days = settings.BILLING_REFUND_DAYS
    if days <= 0 or sub is None or sub.status != SubscriptionStatus.ACTIVE or sub.cancel_at_period_end:
        return None
    if _used_money_back(user):
        return None
    paid = list(sub.payments.filter(status=PaymentTransaction.Status.CAPTURED).exclude(paid_at=None).order_by("paid_at"))
    if not paid:
        return None  # the charge hasn't been recorded yet (it comes with a webhook)
    until = paid[0].paid_at + timedelta(days=days)
    if timezone.now() >= until:
        return None
    return RefundOffer(payments=paid, amount_paise=sum(p.amount_paise for p in paid), currency=paid[0].currency, until=until)


def _used_money_back(user):
    """Whether any refund but an upgrade credit was ever made or started for the user."""
    return (
        PaymentTransaction.objects.filter(user=user)
        .filter(~Q(refund_status=PaymentTransaction.RefundStatus.NONE) | Q(status=PaymentTransaction.Status.REFUNDED))
        .exclude(refund_reason=PaymentTransaction.RefundReason.UPGRADE_CREDIT)
        .exists()
    )


def _request_refund(payment, reason, amount_paise=None):
    """
    Marks a payment for refund (settle_refund makes it). A payment is only ever refunded once: this
    does nothing if a refund of it was asked for already, or seen at Razorpay. Returns whether it marked it.
    """
    return bool(PaymentTransaction.objects.filter(pk=payment.pk, refund_status=PaymentTransaction.RefundStatus.NONE).update(
        refund_status=PaymentTransaction.RefundStatus.REQUESTED, refund_reason=reason, refund_amount_paise=amount_paise,
        refund_op_id=f"{reason}:{payment.pk}", refund_requested_at=timezone.now(),
    ))


# A late "failed" can't undo "processed" (Razorpay doesn't fail a processed refund).
_REFUND_RANK = {"": 0, "requested": 1, "sending": 2, "pending": 3, "failed": 4, "processed": 5}

# How long an attempt holds a refund's claim. Razorpay calls time out long before this, so an older
# claim belongs to an attempt that died, maybe after Razorpay made the refund: Razorpay is asked
# before anyone tries again.
REFUND_CLAIM_TIMEOUT = timedelta(minutes=10)


def _is_full(payment, entity):
    return int(entity.get("amount") or 0) >= payment.amount_paise


def _is_ours(payment, entity):
    """
    Whether a Razorpay refund is the one this payment is tracking: ours by its ID or receipt, or (for
    a whole-payment refund) any full refund, which is also what one made in the Dashboard looks like.
    """
    if entity.get("id") and entity.get("id") == payment.razorpay_refund_id:
        return True
    notes = entity.get("notes") if isinstance(entity.get("notes"), dict) else {}
    if payment.refund_op_id and payment.refund_op_id in (entity.get("receipt"), notes.get("op_id")):
        return True
    return payment.refund_amount_paise is None and _is_full(payment, entity)


def apply_refund(payment, entity):
    """
    Copies a Razorpay refund onto its payment. A late update about the same refund can't undo a newer
    one. Only a full refund marks the payment refunded: after a partial one Razorpay keeps it captured.
    Partial refunds made in the Dashboard aren't tracked.
    """
    if not _is_ours(payment, entity):
        return payment
    status = entity.get("status")
    if status not in (PaymentTransaction.RefundStatus.PENDING, PaymentTransaction.RefundStatus.PROCESSED,
                      PaymentTransaction.RefundStatus.FAILED):
        status = PaymentTransaction.RefundStatus.PENDING
    if entity.get("id") == payment.razorpay_refund_id and _REFUND_RANK[status] < _REFUND_RANK[payment.refund_status]:
        return payment
    payment.razorpay_refund_id = entity.get("id") or payment.razorpay_refund_id
    payment.refund_status = status
    payment.refund_claim = ""
    if payment.refund_requested_at is None:
        payment.refund_requested_at = ts(entity.get("created_at")) or timezone.now()
    if status == PaymentTransaction.RefundStatus.PROCESSED and _is_full(payment, entity):
        payment.status = PaymentTransaction.Status.REFUNDED
    if status == PaymentTransaction.RefundStatus.FAILED:
        logger.error("Refund %s of payment %s failed: refund it from the Razorpay Dashboard",
                     payment.razorpay_refund_id, payment.razorpay_payment_id)
    payment.save()
    return payment


_REFUSED_STATUSES = (400, 422)


def _our_refund_at_razorpay(payment):
    items = razorpay.fetch_refunds(payment.razorpay_payment_id).get("items") or []
    return next((r for r in items if _is_ours(payment, r)), None)


def settle_refund(payment):
    """
    Makes sure a payment marked for refund has its refund at Razorpay, and copies its state.

    No row lock is held while Razorpay is called. Razorpay is asked first, so a refund made by an
    earlier attempt is found (by its receipt, or as a full refund). Only the attempt that claims the
    payment (REQUESTED -> SENDING) asks for a refund, so two can't both make one; Razorpay would also
    refuse a second full refund, but not a second partial one. A claim is kept when Razorpay may have
    made the refund without our hearing back (no answer, or a 5xx): it's checked at Razorpay again
    after REFUND_CLAIM_TIMEOUT. A refusal (400 or 422, e.g. a partial refund in the Dashboard left
    less than this asks for) is permanent, so the refund is marked failed for someone to handle in the
    Dashboard, not retried. Raises RazorpayError if Razorpay can't be reached (reconcile_subscriptions retries).
    """
    payment = PaymentTransaction.objects.get(pk=payment.pk)
    Status = PaymentTransaction.RefundStatus
    if payment.refund_status not in (Status.REQUESTED, Status.SENDING, Status.PENDING):
        return payment
    if payment.refund_status == Status.SENDING and payment.refund_claimed_at > timezone.now() - REFUND_CLAIM_TIMEOUT:
        return payment  # another attempt is making it
    refund = _our_refund_at_razorpay(payment)
    if refund is None and payment.refund_status in (Status.REQUESTED, Status.SENDING):
        claim = uuid.uuid4().hex
        claimed = PaymentTransaction.objects.filter(
            pk=payment.pk, refund_status=payment.refund_status, refund_claim=payment.refund_claim,
        ).update(refund_status=Status.SENDING, refund_claim=claim, refund_claimed_at=timezone.now())
        if not claimed:
            return PaymentTransaction.objects.get(pk=payment.pk)  # another attempt got there first
        try:
            refund = razorpay.refund_payment(
                payment.razorpay_payment_id, amount_paise=payment.refund_paise, receipt=payment.refund_op_id,
                notes={
                    "reason": "upgrade_credit" if payment.refund_reason == PaymentTransaction.RefundReason.UPGRADE_CREDIT
                    else "money_back_window",
                    "user_id": str(payment.user_id), "op_id": payment.refund_op_id,
                },
            )
        except razorpay.RazorpayError as exc:
            # Razorpay refuses a refund for a business reason with 400 (or 422). Other 4xx (rate
            # limits, bad keys) made nothing, so the claim is let go and the refund retried.
            if exc.status not in _REFUSED_STATUSES:
                if exc.status is not None and exc.status < 500:
                    _release_refund_claim(payment, claim)
                raise
            refund = _our_refund_at_razorpay(payment)  # refused because it's refunded already?
            if refund is None:
                return _refund_refused(payment, exc, claim)
    if refund is None:
        return payment
    with transaction.atomic():
        payment = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
        return apply_refund(payment, refund)


def _release_refund_claim(payment, claim):
    PaymentTransaction.objects.filter(
        pk=payment.pk, refund_status=PaymentTransaction.RefundStatus.SENDING, refund_claim=claim,
    ).update(refund_status=PaymentTransaction.RefundStatus.REQUESTED, refund_claim="")


def _refund_refused(payment, exc, claim):
    with transaction.atomic():
        payment = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
        if payment.refund_status == PaymentTransaction.RefundStatus.SENDING and payment.refund_claim == claim:
            payment.refund_status = PaymentTransaction.RefundStatus.FAILED
            payment.refund_claim = ""
            payment.save(update_fields=["refund_status", "refund_claim", "updated_at"])
            logger.error("Razorpay refused to refund payment %s (%s): refund it from the Razorpay Dashboard",
                         payment.razorpay_payment_id, exc.description)
        return payment


# ---------------------------------------------------------------------------
# What the user sees
# ---------------------------------------------------------------------------

def abandon_checkout(sub):
    """
    Cancels a checkout that was never completed, at Razorpay as well, so its payment link can't be
    paid later, and marks it EXPIRED. If Razorpay refuses because it was paid meanwhile, applies
    Razorpay's state instead. Returns True if it was expired. Raises RazorpayError when Razorpay
    can't be reached, or the checkout is still payable and couldn't be cancelled.
    """
    with transaction.atomic():
        sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
        if sub.status != SubscriptionStatus.CREATED:
            return sub.status == SubscriptionStatus.EXPIRED
        try:
            razorpay.cancel_subscription(sub.razorpay_subscription_id, at_cycle_end=False)
        except razorpay.RazorpayError:
            entity = razorpay.fetch_subscription(sub.razorpay_subscription_id)
            if entity.get("status") in OPEN_STATUSES:
                apply_fresh(sub, entity)
                return False
            if entity.get("status") == SubscriptionStatus.CREATED:
                raise
        sub.status = SubscriptionStatus.EXPIRED
        sub.ended_at = timezone.now()
        if sub.replacement_status == ReplacementStatus.AWAITING_PAYMENT:
            sub.replacement_status = ReplacementStatus.ABANDONED
        sub.save(update_fields=["status", "ended_at", "replacement_status", "updated_at"])
        return True


def _stale(sub):
    """Active here, but its paid period and grace are over: a renewal or ending webhook was missed."""
    return sub.status == SubscriptionStatus.ACTIVE and not entitlements.gives_access(sub)


def checkout_blocker(user, refreshed=False):
    """
    Why the user can't start a new subscription now (a BillingError), or None. Only a subscription
    ending with its current period may be followed by a new one. Anything else that can still be
    charged or resumed blocks it, so nobody pays for two.

    A stale active subscription (see _stale) doesn't block unless `refreshed`: checkout fetches it
    from Razorpay first and then asks again with refreshed=True.
    """
    for sub in UserSubscription.objects.filter(user=user, status__in=OPEN_STATUSES).select_related("plan"):
        name = sub.plan.get_tier_display()
        if sub.status == SubscriptionStatus.ACTIVE and sub.cancel_at_period_end:
            continue
        if _stale(sub) and not refreshed:
            continue
        if sub.status == SubscriptionStatus.AUTHENTICATED and sub.start_at and sub.start_at > timezone.now():
            return BillingError(
                f"Your {name} subscription starts on {sub.start_at:%d %b %Y}. Cancel it first to choose another plan.",
                status=409, code="already_scheduled",
            )
        if sub.status == SubscriptionStatus.AUTHENTICATED:
            return BillingError(
                "A subscription is already being set up. Wait a minute for the payment to be confirmed.",
                status=409, code="activation_pending",
            )
        if sub.status == SubscriptionStatus.ACTIVE:
            return BillingError(f"You're already on {name}. Change plan instead.", status=409, code="already_subscribed")
        return BillingError(
            f"Your {name} subscription is waiting for a payment or to be resumed. "
            "Update the payment, resume it or cancel it before subscribing again.",
            status=409, code="subscription_needs_attention",
        )
    return None


def current_subscription(user):
    """The subscription to show: the one giving access, else the latest that got past checkout."""
    sub = entitlements.entitled_subscription(user)
    if sub:
        return sub
    return (
        UserSubscription.objects.filter(user=user)
        .exclude(status__in=[SubscriptionStatus.CREATED, SubscriptionStatus.EXPIRED])
        .select_related("plan", "scheduled_plan")
        .first()
    )


def upcoming_subscription(user, current):
    """A subscription bought to take over when `current` (cancelled at period end) runs out."""
    return (
        UserSubscription.objects.filter(user=user, status__in=[SubscriptionStatus.AUTHENTICATED, SubscriptionStatus.ACTIVE])
        .exclude(pk=getattr(current, "pk", None))
        .filter(start_at__gt=timezone.now())
        .select_related("plan")
        .first()
    )


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def start_checkout(user, plan_code):
    """
    Creates (or reuses) a Razorpay subscription for the plan and returns it. Checkout in the
    browser then authorises it; nothing is granted until Razorpay confirms the payment.
    """
    # Stale active subscriptions are fetched first, and kept even if checkout is then refused.
    for stale in [s for s in UserSubscription.objects.filter(user=user, status=SubscriptionStatus.ACTIVE) if _stale(s)]:
        try:
            reconcile(stale)
        except razorpay.RazorpayError as exc:
            raise _from_razorpay(exc) from exc
    with transaction.atomic():
        _lock_user(user)
        plan = available_plan(plan_code)
        blocker = checkout_blocker(user, refreshed=True)
        if blocker:
            raise blocker
        if tiers.RANK[get_profile(user).plan] >= tiers.RANK[plan.tier]:
            raise BillingError("Your account already includes this plan.", status=409, code="already_included")
        # Replacing a subscription that ends at period end: start billing when it runs out.
        current = entitlements.entitled_subscription(user)
        return _create_checkout(user, plan, start_at=current.current_end if current else None)


def _create_checkout(user, plan, *, start_at=None, replaces=None):
    """
    Creates the Razorpay subscription for a checkout, under the user's BillingLock. A repeated click,
    or a retry after closing Checkout, reuses the subscription already created. Any other checkout
    not completed (another plan, another tab, or too old) is cancelled first, so only one can ever be paid.
    """
    reuse_after = timezone.now() - timedelta(minutes=settings.BILLING_CHECKOUT_REUSE_MINUTES)
    for old in UserSubscription.objects.filter(user=user, status=SubscriptionStatus.CREATED):
        if old.plan_id == plan.id and old.replaces_id == getattr(replaces, "pk", None) and old.created_at > reuse_after:
            return old
        try:
            expired = abandon_checkout(old)
        except razorpay.RazorpayError as exc:
            raise _from_razorpay(exc) from exc
        if not expired:
            raise BillingError(
                "An earlier checkout went through. Wait a minute for the payment to be confirmed.",
                status=409, code="activation_pending",
            )

    notes = {"user_id": str(user.id), "plan": plan.code}
    if replaces:
        notes["replaces"] = replaces.razorpay_subscription_id
    try:
        entity = razorpay.create_subscription(
            plan_id=plan.razorpay_plan_id,
            total_count=settings.RAZORPAY_TOTAL_COUNT[plan.interval],
            notes=notes,
            start_at=start_at,
            expire_by=timezone.now() + CHECKOUT_EXPIRY,
        )
    except razorpay.RazorpayError as exc:
        raise _from_razorpay(exc) from exc
    try:
        with transaction.atomic():
            return UserSubscription.objects.create(
                user=user, plan=plan, interval=plan.interval, razorpay_subscription_id=entity["id"],
                status=SubscriptionStatus.CREATED, short_url=entity.get("short_url") or "", start_at=start_at,
                replaces=replaces, replacement_status=ReplacementStatus.AWAITING_PAYMENT if replaces else ReplacementStatus.NONE,
            )
    except Exception as exc:
        # Not saved, so nothing here would ever track it: don't leave it payable at Razorpay.
        try:
            razorpay.cancel_subscription(entity["id"], at_cycle_end=False)
        except razorpay.RazorpayError:
            logger.error("Razorpay subscription %s was created but not saved, and couldn't be cancelled", entity["id"])
        if isinstance(exc, IntegrityError) and replaces:
            raise BillingError("An upgrade is already under way.", status=409, code="upgrade_in_progress") from exc
        raise


def verify_checkout(user, *, payment_id, subscription_id, signature):
    """
    Checks the signature from Checkout, then asks Razorpay for the subscription's state. Access
    comes from that state (or the webhooks that follow), never from the browser's word.
    """
    sub = UserSubscription.objects.filter(user=user, razorpay_subscription_id=subscription_id).select_related("plan").first()
    if sub is None:
        raise BillingError("Subscription not found.", status=404, code="not_found")
    if not razorpay.verify_checkout_signature(payment_id=payment_id, subscription_id=sub.razorpay_subscription_id, signature=signature):
        logger.warning("Invalid checkout signature for subscription %s", sub.razorpay_subscription_id)
        raise BillingError("The payment couldn't be verified.", code="invalid_signature")
    try:
        entity = razorpay.fetch_subscription(sub.razorpay_subscription_id)
    except razorpay.RazorpayError:
        entity = None  # the webhook will bring the state
    with transaction.atomic():
        sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
        if sub.checkout_verified_at is None:
            sub.checkout_verified_at = timezone.now()
            sub.save(update_fields=["checkout_verified_at", "updated_at"])
        if entity:
            apply_fresh(sub, entity)
    return sub


def _plan_change(user, plan_code):
    """The subscription to change and the plan to change it to, or a BillingError saying why not."""
    sub = entitlements.entitled_subscription(user)
    if sub is None or sub.status != SubscriptionStatus.ACTIVE:
        raise BillingError("You need an active subscription to change plan.", status=409, code="no_active_subscription")
    if sub.cancel_at_period_end:
        raise BillingError(
            "This subscription is cancelled at the end of its period. Subscribe to the new plan instead.",
            status=409, code="cancellation_scheduled",
        )
    new = available_plan(plan_code)
    if new.id == sub.plan_id:
        raise BillingError("You're already on this plan.", code="same_plan")
    if new.id == sub.scheduled_plan_id:
        raise BillingError("This change is already scheduled.", status=409, code="already_scheduled")
    return sub, new


def _is_upgrade(sub, plan):
    return tiers.RANK[plan.tier] > tiers.RANK[sub.tier]


_CHANGE_UNSUPPORTED = (
    "Plans paid by UPI Autopay or eMandate can't be changed. Cancel at the end of the period and subscribe to the new plan."
)


def change_plan(user, plan_code):
    """
    Upgrades now, or schedules a downgrade or interval switch for the end of the cycle. An upgrade
    Razorpay can't apply in place (upgrade_strategy) starts a checkout for a replacement instead.
    Returns (subscription, "now", "cycle_end" or "checkout"); for "checkout" it's the new one, to pay.
    """
    with transaction.atomic():
        _lock_user(user)
        sub, new = _plan_change(user, plan_code)
        upgrade = _is_upgrade(sub, new)
        if upgrade_strategy(sub) == REPLACEMENT:
            if not upgrade:
                raise BillingError(_CHANGE_UNSUPPORTED, status=409, code="change_unsupported")
            return start_replacement(user, sub, new), "checkout"
        try:
            entity = razorpay.update_subscription(
                sub.razorpay_subscription_id, plan_id=new.razorpay_plan_id, schedule_change_at="now" if upgrade else "cycle_end"
            )
        except razorpay.RazorpayError as exc:
            raise _from_razorpay(exc) from exc
        sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
        apply_fresh(sub, entity)
        if not upgrade and entity.get("has_scheduled_changes", True):
            sub.scheduled_plan = new
            sub.scheduled_change_at = ts(entity.get("change_scheduled_at")) or sub.current_end
            sub.save(update_fields=["scheduled_plan", "scheduled_change_at", "updated_at"])
        return sub, "now" if upgrade else "cycle_end"


# ---------------------------------------------------------------------------
# Upgrades that replace the subscription
# ---------------------------------------------------------------------------
#
# Razorpay can't move a UPI Autopay or eMandate subscription to another plan. Upgrading one buys a
# new subscription to start now instead. Nothing happens to the old one until the new one is paid
# and active; then finish_replacement cancels the old one now and refunds its unused days (the
# credit) to the payment for its current period. Once the new one is active the upgrade stands:
# failures from there are retried (a task, then reconcile_subscriptions), never undone.

NATIVE_CHANGE = "native_change"
REPLACEMENT = "replacement"

# Razorpay only refunds a payment for a while after it's made (about six months; confirm in test
# mode). A credit owed on an older payment couldn't be refunded, so that upgrade isn't offered.
REFUND_MAX_AGE = timedelta(days=180)
# Razorpay's smallest refund.
MIN_REFUND_PAISE = 100


def upgrade_strategy(sub):
    """How `sub` is upgraded: moved to the new plan by Razorpay, or replaced. Decided from its latest payment."""
    method = sub.payments.exclude(method="").values_list("method", flat=True).first()
    return REPLACEMENT if method in NO_PLAN_CHANGE_METHODS else NATIVE_CHANGE


@dataclass
class Credit:
    payment: PaymentTransaction | None
    amount_paise: int
    # The whole payment: the old plan was still inside the money-back window.
    full: bool
    # Why nothing is refunded ("no_payment", "below_minimum", "too_old"), or "". For "too_old",
    # amount_paise is what's owed but can't be refunded.
    reason: str = ""

    @property
    def refundable(self):
        return not self.reason and self.amount_paise > 0


def _credit(user, old, at, period_start, period_end):
    """
    What replacing `old` at `at` refunds: the unused part of the payment for the period `at` falls in
    (the latest captured one before it), counted to the second in integer paise. The whole payment
    if `old` was still inside the money-back window then.
    """
    payment = old.payments.filter(status=PaymentTransaction.Status.CAPTURED, paid_at__lte=at).order_by("-paid_at").first()
    if payment is None or payment.refund_status != PaymentTransaction.RefundStatus.NONE or not (period_start and period_end):
        return Credit(None, 0, False, "no_payment")
    full = _money_back_open(user, old, at)
    if full:
        amount = payment.amount_paise
    else:
        length = int((period_end - period_start).total_seconds())
        left = max(0, int((period_end - at).total_seconds()))
        amount = min(payment.amount_paise, payment.amount_paise * left // length) if length > 0 else 0
    if payment.paid_at < timezone.now() - REFUND_MAX_AGE:
        return Credit(payment, amount, full, "too_old")
    if amount < MIN_REFUND_PAISE:
        return Credit(payment, 0, False, "below_minimum")
    return Credit(payment, amount, full)


def _money_back_open(user, sub, at):
    """Whether `sub` was inside the money-back window at `at` (refund_offer's rule, at a given time)."""
    days = settings.BILLING_REFUND_DAYS
    if days <= 0 or _used_money_back(user):
        return False
    first = sub.payments.filter(status=PaymentTransaction.Status.CAPTURED).exclude(paid_at=None).order_by("paid_at").first()
    return first is not None and at < first.paid_at + timedelta(days=days)


@dataclass
class UpgradeQuote:
    strategy: str
    plan: SubscriptionPlan
    # Only for a replacement: an estimate, since the credit is worked out when the new plan starts.
    credit: Credit | None


def upgrade_quote(user, plan_code):
    """What upgrading to the plan would do now, for the confirmation dialog."""
    sub, new = _plan_change(user, plan_code)
    if not _is_upgrade(sub, new):
        raise BillingError("That's not an upgrade.", code="not_an_upgrade")
    if upgrade_strategy(sub) == NATIVE_CHANGE:
        return UpgradeQuote(NATIVE_CHANGE, new, None)
    return UpgradeQuote(REPLACEMENT, new, _credit(user, sub, timezone.now(), sub.current_start, sub.current_end))


def start_replacement(user, old, plan):
    """
    Creates the checkout for a subscription to replace `old`, under the user's BillingLock. `old`
    isn't touched. Refused when its credit couldn't be refunded, before anything is charged.
    """
    if UserSubscription.objects.filter(user=user, replacement_status=ReplacementStatus.FINISHING).exists():
        raise BillingError("Your last upgrade is still being finished. Try again in a few minutes.",
                           status=409, code="upgrade_in_progress")
    if _credit(user, old, timezone.now(), old.current_start, old.current_end).reason == "too_old":
        raise BillingError(
            "Your current plan was paid too long ago for its unused days to be refunded, so it can't be upgraded now. "
            "Cancel it at the end of the period and subscribe to the new plan: it starts when your current plan ends.",
            status=409, code="upgrade_at_renewal",
        )
    return _create_checkout(user, plan, replaces=old)


def _begin_finishing(sub):
    """
    The replacement `sub` is paid. Records when it started and the replaced subscription's period
    then (the credit counts from these), and queues finish_replacement. Called by apply_snapshot.
    """
    old = sub.replaces
    sub.replacement_status = ReplacementStatus.FINISHING
    sub.credit_from = sub.current_start or timezone.now()
    sub.credit_period_start, sub.credit_period_end = old.current_start, old.current_end
    logger.info("Upgrade %s is paid: finishing the replacement of %s", sub.razorpay_subscription_id, old.razorpay_subscription_id)
    sub_id = sub.pk
    transaction.on_commit(lambda: _queue_finish(sub_id), robust=True)


def _queue_finish(sub_id):
    from .tasks import finish_replacement_task  # tasks imports this module

    finish_replacement_task.delay(sub_id)


def finish_replacement(sub_id):
    """
    Cancels the subscription the paid replacement `sub_id` replaces, and refunds its credit. Safe to
    run any number of times, at once too: each step checks what's done, under the user's BillingLock.

    1. Razorpay's state of the old subscription is fetched, and the credit decided from it once
       (saved, so a retry can't change it). One that had ended before the upgrade gets none.
    2. It's cancelled now. If Razorpay refuses, one already set to end at period end is left to end
       (it can't renew); any other is left for someone to look at (NEEDS_ATTENTION), unrefunded.
    3. Only then is anything marked for refund: the credit, and in full any renewal the old
       subscription charged after the upgrade. The refunds are made after the lock is let go.

    Raises RazorpayError if Razorpay can't be reached; the task, then reconcile_subscriptions, retry.
    """
    sub = UserSubscription.objects.select_related("user").get(pk=sub_id)
    with transaction.atomic():
        _lock_user(sub.user)
        sub = UserSubscription.objects.select_for_update().select_related("user", "plan").get(pk=sub_id)
        if sub.replacement_status != ReplacementStatus.FINISHING:
            return sub
        old = UserSubscription.objects.select_for_update().get(pk=sub.replaces_id)
        apply_fresh(old, razorpay.fetch_subscription(old.razorpay_subscription_id))
        if sub.credit_paise is None:
            _decide_credit(sub, old)

    with transaction.atomic():
        _lock_user(sub.user)
        sub = UserSubscription.objects.select_for_update().select_related("user", "plan").get(pk=sub_id)
        if sub.replacement_status != ReplacementStatus.FINISHING:
            return sub
        old = UserSubscription.objects.select_for_update().get(pk=sub.replaces_id)
        problem = _end_now(old)
        if problem:
            sub.replacement_status = ReplacementStatus.NEEDS_ATTENTION
            sub.replacement_error = problem[:300]
            sub.save(update_fields=["replacement_status", "replacement_error", "updated_at"])
            logger.error("Upgrade %s: %s", sub.razorpay_subscription_id, problem)
            return sub
        # Renewals charged after the upgrade paid for a period it replaced.
        for renewal in old.payments.filter(status=PaymentTransaction.Status.CAPTURED, paid_at__gt=sub.credit_from):
            if renewal.pk != sub.credit_payment_id:
                _request_refund(renewal, PaymentTransaction.RefundReason.UPGRADE_CREDIT)
        if sub.credit_reason == "too_old":
            sub.replacement_status = ReplacementStatus.NEEDS_ATTENTION
            sub.replacement_error = (
                f"Credit of {sub.credit_paise} paise on payment {sub.credit_payment.razorpay_payment_id} is too old to "
                "refund automatically: refund or credit it by hand."
            )
            logger.error("Upgrade %s: %s", sub.razorpay_subscription_id, sub.replacement_error)
        else:
            if sub.credit_paise:
                payment = sub.credit_payment
                _request_refund(payment, PaymentTransaction.RefundReason.UPGRADE_CREDIT,
                                None if sub.credit_paise >= payment.amount_paise else sub.credit_paise)
            sub.replacement_status = ReplacementStatus.DONE
        sub.save(update_fields=["replacement_status", "replacement_error", "updated_at"])

    # Outside the transaction, as in cancel(): a refund made at Razorpay must never be rolled back here.
    for payment in old.payments.filter(
        refund_reason=PaymentTransaction.RefundReason.UPGRADE_CREDIT, refund_status=PaymentTransaction.RefundStatus.REQUESTED,
    ):
        try:
            settle_refund(payment)
        except razorpay.RazorpayError as exc:
            logger.warning("Refund of payment %s not made yet, will retry: %s", payment.razorpay_payment_id, exc.description)
        except Exception:
            logger.exception("Refund of payment %s failed here, will retry", payment.razorpay_payment_id)
    notify(sub, "upgraded")
    return sub


def _decide_credit(sub, old):
    """Decides and saves the credit, from Razorpay's state of the replaced subscription `old`."""
    if old.status in TERMINAL_STATUSES and old.ended_at and old.ended_at <= sub.credit_from:
        credit = Credit(None, 0, False, "already_ended")  # cancelled (or refunded) before the upgrade
    else:
        start, end = old.current_start, old.current_end
        if start is None or start > sub.credit_from:
            # Renewed since the upgrade (or no period known): the period it was in then.
            start, end = sub.credit_period_start, sub.credit_period_end
        credit = _credit(sub.user, old, sub.credit_from, start, end)
    sub.credit_payment = credit.payment
    sub.credit_paise = credit.amount_paise
    sub.credit_reason = credit.reason
    sub.save(update_fields=["credit_payment", "credit_paise", "credit_reason", "updated_at"])


def _end_now(old):
    """
    Cancels the replaced subscription now, under the lock. Returns None once it can't charge again,
    or what's wrong if Razorpay refused to cancel one that still renews. Raises RazorpayError if
    Razorpay can't be reached.
    """
    if old.status in TERMINAL_STATUSES:
        return None
    try:
        entity = razorpay.cancel_subscription(old.razorpay_subscription_id, at_cycle_end=False)
    except razorpay.RazorpayError as exc:
        if exc.status not in _REFUSED_STATUSES:
            raise
        apply_fresh(old, razorpay.fetch_subscription(old.razorpay_subscription_id))
        if old.status in TERMINAL_STATUSES or old.cancel_at_period_end:
            return None
        return f"Razorpay wouldn't cancel the replaced subscription {old.razorpay_subscription_id}: {exc.description}"
    old.cancel_requested_at = timezone.now()
    old.save(update_fields=["cancel_requested_at", "updated_at"])
    apply_fresh(old, entity)
    return None


def cancel(user, *, at_period_end=True, upcoming=False, expect_refund=False):
    """
    Cancels the current subscription or, with `upcoming`, the one bought to start when it ends.
    That one hasn't charged anything yet, so it's always cancelled straight away.

    Cancelling now inside the money-back window (refund_offer) also refunds the subscription. The
    payments are marked for refund along with the cancellation, and refunded once that's saved; a
    refund Razorpay doesn't take now is retried by reconcile_subscriptions. With `expect_refund`
    (the user was shown a refund), nothing is cancelled if the window has closed since.

    Returns (subscription, the RefundOffer for the refunds under way or None, whether any refund
    failed straight away).
    """
    offer = None
    with transaction.atomic():
        _lock_user(user)
        sub = current_subscription(user)
        if upcoming:
            sub = upcoming_subscription(user, sub)
            at_period_end = False
        if sub is None or sub.status in TERMINAL_STATUSES:
            raise BillingError("You don't have a subscription to cancel.", status=409, code="no_subscription")
        if at_period_end and sub.cancel_at_period_end:
            raise BillingError("This subscription is already set to end with its current period.", status=409, code="already_cancelled")
        if at_period_end and sub.status != SubscriptionStatus.ACTIVE:
            raise BillingError(
                "This subscription has no paid period running, so it can only be cancelled now.",
                status=409, code="cancel_now_only",
            )
        if not at_period_end and not upcoming:
            offer = refund_offer(user, sub)
            if expect_refund and offer is None:
                raise BillingError(
                    "The money-back window has closed, so cancelling now wouldn't be refunded. Nothing was cancelled.",
                    status=409, code="refund_window_closed",
                )
        try:
            entity = razorpay.cancel_subscription(sub.razorpay_subscription_id, at_cycle_end=at_period_end)
        except razorpay.RazorpayError as exc:
            raise _from_razorpay(exc) from exc
        sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
        sub.cancel_requested_at = timezone.now()
        sub.cancel_at_period_end = at_period_end
        sub.save(update_fields=["cancel_requested_at", "cancel_at_period_end", "updated_at"])
        apply_fresh(sub, entity)
        if offer:
            for payment in offer.payments:
                _request_refund(payment, PaymentTransaction.RefundReason.MONEY_BACK)
        kind = "upcoming_cancelled" if upcoming else ("cancel_scheduled" if at_period_end else "cancelled")
        if not offer:
            transaction.on_commit(lambda: notify(sub, kind))
    if not offer:
        return sub, None, False
    # Outside the transaction: a refund made at Razorpay must never be rolled back here. The
    # cancellation is saved, so nothing from here on may fail the request; reconcile retries.
    under_way = []
    for payment in offer.payments:
        try:
            payment = settle_refund(payment)
        except razorpay.RazorpayError as exc:
            logger.warning("Refund of payment %s not made yet, will retry: %s", payment.razorpay_payment_id, exc.description)
        except Exception:
            logger.exception("Refund of payment %s failed here, will retry", payment.razorpay_payment_id)
        if payment.refund_status != PaymentTransaction.RefundStatus.FAILED:
            under_way.append(payment)  # including one still to be retried
    # After the refunds, so the email only mentions one that hasn't failed.
    notify(sub, kind)
    refunded = RefundOffer(
        payments=under_way, amount_paise=sum(p.amount_paise for p in under_way), currency=offer.currency, until=offer.until,
    ) if under_way else None
    return sub, refunded, len(under_way) < len(offer.payments)


def resume(user):
    """
    Resumes a paused subscription. For one whose payments failed, returns Razorpay's link to pay
    again or change card. Returns (subscription, payment_url or None).
    """
    with transaction.atomic():
        _lock_user(user)
        sub = current_subscription(user)
        if sub is None or sub.status in TERMINAL_STATUSES:
            raise BillingError("There's no subscription to resume. Choose a plan to subscribe.", status=409, code="no_subscription")
        if sub.status == SubscriptionStatus.PAUSED:
            try:
                entity = razorpay.resume_subscription(sub.razorpay_subscription_id)
            except razorpay.RazorpayError as exc:
                raise _from_razorpay(exc) from exc
            sub = UserSubscription.objects.select_for_update().get(pk=sub.pk)
            apply_fresh(sub, entity)
            return sub, None
        if sub.status in (SubscriptionStatus.PENDING, SubscriptionStatus.HALTED):
            if not sub.short_url:
                raise BillingError("Contact support to update your payment method.", status=409, code="no_payment_link")
            return sub, sub.short_url
        if sub.cancel_at_period_end:
            raise BillingError(
                "A cancelled subscription can't be restarted. Subscribe again: billing starts when the current period ends.",
                status=409, code="cancellation_final",
            )
        raise BillingError("Your subscription is already running.", status=409, code="nothing_to_resume")
