"""
Subscription lifecycle: checkout, verification, plan changes, cancellation and recovery.

Local subscription state is only ever copied from Razorpay (a webhook, or a response to a
server-side API call); nothing the browser sends changes it except a checkout signature, which
only marks the checkout as verified. Every action runs under the user's BillingLock, so one user's
billing requests are applied one at a time, and a slow Razorpay call holds up nothing else.

Policies (see README "Plans and billing"):
- Upgrades (to a higher tier) apply now: Razorpay moves the subscription to the new plan straight
  away and bills it by its own rules; no proration is calculated here.
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
    """
    days = settings.BILLING_REFUND_DAYS
    if days <= 0 or sub is None or sub.status != SubscriptionStatus.ACTIVE:
        return None
    refunded_before = PaymentTransaction.objects.filter(user=user).filter(
        ~Q(refund_status=PaymentTransaction.RefundStatus.NONE) | Q(status=PaymentTransaction.Status.REFUNDED)
    )
    if refunded_before.exists():
        return None
    paid = list(sub.payments.filter(status=PaymentTransaction.Status.CAPTURED).exclude(paid_at=None).order_by("paid_at"))
    if not paid:
        return None  # the charge hasn't been recorded yet (it comes with a webhook)
    until = paid[0].paid_at + timedelta(days=days)
    if timezone.now() >= until:
        return None
    return RefundOffer(payments=paid, amount_paise=sum(p.amount_paise for p in paid), currency=paid[0].currency, until=until)


_REFUND_RANK = {"": 0, "requested": 1, "pending": 2, "processed": 3, "failed": 3}


def apply_refund(payment, entity):
    """Copies a Razorpay refund onto its payment. A late update about the same refund can't undo a newer one."""
    status = entity.get("status")
    if status not in (PaymentTransaction.RefundStatus.PENDING, PaymentTransaction.RefundStatus.PROCESSED,
                      PaymentTransaction.RefundStatus.FAILED):
        status = PaymentTransaction.RefundStatus.PENDING
    if entity.get("id") == payment.razorpay_refund_id and _REFUND_RANK[status] < _REFUND_RANK[payment.refund_status]:
        return payment
    payment.razorpay_refund_id = entity.get("id") or payment.razorpay_refund_id
    payment.refund_status = status
    if payment.refund_requested_at is None:
        payment.refund_requested_at = ts(entity.get("created_at")) or timezone.now()
    if status == PaymentTransaction.RefundStatus.PROCESSED:
        payment.status = PaymentTransaction.Status.REFUNDED
    if status == PaymentTransaction.RefundStatus.FAILED:
        logger.error("Refund %s of payment %s failed: refund it from the Razorpay Dashboard",
                     payment.razorpay_refund_id, payment.razorpay_payment_id)
    payment.save()
    return payment


def settle_refund(payment):
    """
    Makes sure a payment marked for refund has one at Razorpay, and copies its state. Razorpay is
    asked first, so a refund made by an attempt that failed afterwards is found, not made twice.
    Raises RazorpayError if Razorpay can't be reached (reconcile_subscriptions retries).
    """
    with transaction.atomic():
        payment = PaymentTransaction.objects.select_for_update().get(pk=payment.pk)
        if payment.refund_status not in (PaymentTransaction.RefundStatus.REQUESTED, PaymentTransaction.RefundStatus.PENDING):
            return payment
        items = razorpay.fetch_refunds(payment.razorpay_payment_id).get("items") or []
        if not items and payment.refund_status == PaymentTransaction.RefundStatus.REQUESTED:
            items = [razorpay.refund_payment(
                payment.razorpay_payment_id, notes={"reason": "money_back_window", "user_id": str(payment.user_id)}
            )]
        if items:
            apply_refund(payment, items[0])
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
        sub.save(update_fields=["status", "ended_at", "updated_at"])
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

        # A repeated click, or a retry after closing Checkout, reuses the subscription already created.
        # Any other checkout not completed (another plan, another tab, or too old) is cancelled first,
        # so only one can ever be paid.
        reuse_after = timezone.now() - timedelta(minutes=settings.BILLING_CHECKOUT_REUSE_MINUTES)
        for old in UserSubscription.objects.filter(user=user, status=SubscriptionStatus.CREATED):
            if old.plan_id == plan.id and old.created_at > reuse_after:
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

        # Replacing a subscription that ends at period end: start billing when it runs out.
        current = entitlements.entitled_subscription(user)
        start_at = current.current_end if current else None
        try:
            entity = razorpay.create_subscription(
                plan_id=plan.razorpay_plan_id,
                total_count=settings.RAZORPAY_TOTAL_COUNT[plan.interval],
                notes={"user_id": str(user.id), "plan": plan.code},
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
                )
        except Exception:
            # Not saved, so nothing here would ever track it: don't leave it payable at Razorpay.
            try:
                razorpay.cancel_subscription(entity["id"], at_cycle_end=False)
            except razorpay.RazorpayError:
                logger.error("Razorpay subscription %s was created but not saved, and couldn't be cancelled", entity["id"])
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


def change_plan(user, plan_code):
    """Upgrades now, or schedules a downgrade or interval switch for the end of the cycle."""
    with transaction.atomic():
        _lock_user(user)
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
        method = sub.payments.exclude(method="").values_list("method", flat=True).first()
        if method in NO_PLAN_CHANGE_METHODS:
            raise BillingError(
                "Plans paid by UPI Autopay or eMandate can't be changed. Cancel at the end of the period and subscribe to the new plan.",
                status=409, code="change_unsupported",
            )

        upgrade = tiers.RANK[new.tier] > tiers.RANK[sub.tier]
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
        return sub, upgrade


def cancel(user, *, at_period_end=True, upcoming=False):
    """
    Cancels the current subscription or, with `upcoming`, the one bought to start when it ends.
    That one hasn't charged anything yet, so it's always cancelled straight away.

    Cancelling now inside the money-back window (refund_offer) also refunds the subscription. The
    payments are marked for refund along with the cancellation, and refunded once that's saved; a
    refund Razorpay doesn't take now is retried by reconcile_subscriptions.
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
            PaymentTransaction.objects.filter(pk__in=[p.pk for p in offer.payments]).update(
                refund_status=PaymentTransaction.RefundStatus.REQUESTED, refund_requested_at=timezone.now(),
            )
        kind = "upcoming_cancelled" if upcoming else ("cancel_scheduled" if at_period_end else "cancelled")
        transaction.on_commit(lambda: notify(sub, kind))
    # Outside the transaction: a refund made at Razorpay must never be rolled back here.
    for payment in offer.payments if offer else []:
        try:
            settle_refund(payment)
        except razorpay.RazorpayError as exc:
            logger.warning("Refund of payment %s not made yet, will retry: %s", payment.razorpay_payment_id, exc.description)
    return sub


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
