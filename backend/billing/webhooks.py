"""
Razorpay webhook processing. The view checks the signature; this stores each event once by its
ID and applies it. Razorpay sends the same event more than once and in any order, so:
- an event already processed (or ignored) is acknowledged and not applied again;
- a failed one is applied again when Razorpay retries it;
- each event carries a snapshot of the subscription, applied only if it's newer than the last
  one applied (services.apply_snapshot), and payments only ever move forward;
- a body already received under another event ID is a replay, and isn't applied again.
"""
import logging

from django.db import transaction
from django.utils import timezone

from . import razorpay
from .models import PaymentTransaction, SubscriptionStatus, TERMINAL_STATUSES, UserSubscription, WebhookEvent
from .notifications import notify
from .services import apply_fresh, apply_refund, apply_snapshot, record_payment, ts

logger = logging.getLogger(__name__)

HANDLED = {
    "subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.updated",
    "subscription.pending", "subscription.halted", "subscription.cancelled", "subscription.completed",
    "subscription.paused", "subscription.resumed",
    "payment.authorized", "payment.captured", "payment.failed",
    "refund.created", "refund.processed", "refund.failed",
}

# Customer contact and payment instrument details: dropped before an event is stored.
_SENSITIVE = {"email", "contact", "vpa", "bank_account", "customer_details", "token", "upi", "acquirer_data", "notes"}


def redact(value):
    if isinstance(value, dict):
        return {
            # A card keeps only its network, which the payment history shows (and a reprocessed event needs).
            k: {"network": v.get("network")} if k == "card" and isinstance(v, dict) else redact(v)
            for k, v in value.items() if k not in _SENSITIVE
        }
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def _entity(data, name):
    entity = ((data.get("payload") or {}).get(name) or {}).get("entity")
    return entity if isinstance(entity, dict) and entity.get("id") else None


def _find_subscription(sub_entity, pay_entity):
    query = UserSubscription.objects.select_for_update().select_related("plan", "user")
    if sub_entity:
        return query.filter(razorpay_subscription_id=sub_entity["id"]).first()
    if pay_entity.get("subscription_id"):
        return query.filter(razorpay_subscription_id=pay_entity["subscription_id"]).first()
    # A payment event on its own: match it through a payment or invoice already recorded.
    known = PaymentTransaction.objects.filter(razorpay_payment_id=pay_entity["id"]).values_list("subscription_id", flat=True).first()
    if known is None and pay_entity.get("invoice_id"):
        known = (
            PaymentTransaction.objects.filter(razorpay_invoice_id=pay_entity["invoice_id"])
            .values_list("subscription_id", flat=True).first()
        )
    return query.filter(pk=known).first() if known else None


_NOT_STARTED = (SubscriptionStatus.CREATED, SubscriptionStatus.AUTHENTICATED)
_STARTED = (SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING, SubscriptionStatus.HALTED, SubscriptionStatus.PAUSED)


def _notification(event_type, before, sub, sub_entity):
    # Razorpay sends both activated and charged for the first payment, in either order: whichever
    # arrives first starts the subscription, and a renewal is a charge after the first.
    if event_type in ("subscription.activated", "subscription.charged") and before in _NOT_STARTED:
        return "activated" if sub.status == SubscriptionStatus.ACTIVE else None
    if event_type == "subscription.charged" and int(sub_entity.get("paid_count") or 0) > 1:
        return "renewed"
    if event_type == "subscription.cancelled":
        # Only a subscription that had started has a plan to end; the user was emailed already if
        # they cancelled it here (it's cancelled before the event arrives).
        return "cancelled" if before in _STARTED else None
    return {
        "subscription.pending": "payment_failed",
        "subscription.halted": "halted",
    }.get(event_type)


def apply_event(event_type, data, occurred_at):
    """Applies one event. Returns PROCESSED, or IGNORED for events about nothing of ours."""
    if event_type not in HANDLED:
        return WebhookEvent.Status.IGNORED
    sub_entity = _entity(data, "subscription")
    pay_entity = _entity(data, "payment")
    if not (sub_entity or pay_entity):
        return WebhookEvent.Status.IGNORED
    sub = _find_subscription(sub_entity, pay_entity)
    if sub is None:
        # Not created by this app (e.g. made in the Dashboard): nothing to grant.
        logger.info("Ignoring %s for an unknown subscription", event_type)
        return WebhookEvent.Status.IGNORED

    before = sub.status
    applied = apply_snapshot(sub, sub_entity, occurred_at) if sub_entity else False
    if sub_entity and not applied and sub.status not in TERMINAL_STATUSES and sub_entity.get("status") != sub.status:
        _refresh(sub)
    if pay_entity:
        payment = record_payment(sub, pay_entity, occurred_at)
        # Refund events carry the refund and its payment.
        refund_entity = _entity(data, "refund")
        if refund_entity and refund_entity.get("payment_id") == payment.razorpay_payment_id:
            apply_refund(payment, refund_entity)
    kind = _notification(event_type, before, sub, sub_entity) if applied else None
    if kind:
        transaction.on_commit(lambda: notify(sub, kind))
    return WebhookEvent.Status.PROCESSED


def _refresh(sub):
    """
    A snapshot was skipped as older than ours but disagrees with it. Clocks can differ (ours stamps
    what server-side calls return), so ask Razorpay rather than risk keeping the stale state.
    """
    try:
        apply_fresh(sub, razorpay.fetch_subscription(sub.razorpay_subscription_id))
    except razorpay.RazorpayError as exc:
        logger.warning("Couldn't refresh subscription %s: %s", sub.razorpay_subscription_id, exc.description)


def handle(event_id, data, body_sha256=""):
    """Stores and applies a verified event, once. Returns the WebhookEvent."""
    event_type = str(data.get("event") or "")[:60]
    occurred_at = ts(data.get("created_at"))
    with transaction.atomic():
        if body_sha256:
            replay = WebhookEvent.objects.filter(body_sha256=body_sha256).exclude(event_id=event_id[:64]).first()
            if replay:
                logger.warning("Webhook %s repeats the body of %s; not applied", event_id, replay.event_id)
                return replay
        event, _ = WebhookEvent.objects.select_for_update().get_or_create(
            event_id=event_id[:64],
            defaults={
                "event_type": event_type, "payload": redact(data), "occurred_at": occurred_at, "body_sha256": body_sha256,
            },
        )
        if event.status in (WebhookEvent.Status.PROCESSED, WebhookEvent.Status.IGNORED):
            return event  # a repeat delivery
        event.attempts += 1
        try:
            with transaction.atomic():
                event.status = apply_event(event_type, data, occurred_at)
            event.error = ""
            event.processed_at = timezone.now()
        except Exception as exc:
            logger.exception("Razorpay webhook %s (%s) failed", event_id, event_type)
            event.status = WebhookEvent.Status.FAILED
            event.error = f"{exc.__class__.__name__}: {exc}"[:500]
        event.save()
    return event
