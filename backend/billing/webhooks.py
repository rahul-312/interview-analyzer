"""
Razorpay webhook processing. The view checks the signature; this stores each event once by its
ID and applies it. Razorpay sends the same event more than once and in any order, so:
- an event already processed (or ignored) is acknowledged and not applied again;
- a failed one is applied again when Razorpay retries it;
- each event carries a snapshot of the subscription, applied only if it's newer than the last
  one applied (services.apply_snapshot), and payments only ever move forward.
"""
import logging

from django.db import transaction
from django.utils import timezone

from .models import PaymentTransaction, SubscriptionStatus, UserSubscription, WebhookEvent
from .notifications import notify
from .services import apply_snapshot, record_payment, ts

logger = logging.getLogger(__name__)

HANDLED = {
    "subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.updated",
    "subscription.pending", "subscription.halted", "subscription.cancelled", "subscription.completed",
    "subscription.paused", "subscription.resumed",
    "payment.authorized", "payment.captured", "payment.failed",
}

# Customer contact and payment instrument details: dropped before an event is stored.
_SENSITIVE = {"email", "contact", "card", "vpa", "bank_account", "customer_details", "token", "upi", "acquirer_data", "notes"}


def redact(value):
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items() if k not in _SENSITIVE}
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


def _notification(event_type, before, sub):
    if event_type == "subscription.activated" and before != SubscriptionStatus.ACTIVE:
        return "activated"
    if event_type == "subscription.charged" and before == SubscriptionStatus.ACTIVE:
        return "renewed"
    return {
        "subscription.pending": "payment_failed",
        "subscription.halted": "halted",
        "subscription.cancelled": "cancelled",
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
    if pay_entity:
        record_payment(sub, pay_entity, occurred_at)
    kind = _notification(event_type, before, sub) if applied else None
    if kind:
        transaction.on_commit(lambda: notify(sub, kind))
    return WebhookEvent.Status.PROCESSED


def handle(event_id, data):
    """Stores and applies a verified event, once. Returns the WebhookEvent."""
    event_type = str(data.get("event") or "")[:60]
    occurred_at = ts(data.get("created_at"))
    with transaction.atomic():
        event, _ = WebhookEvent.objects.select_for_update().get_or_create(
            event_id=event_id[:64],
            defaults={"event_type": event_type, "payload": redact(data), "occurred_at": occurred_at},
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
