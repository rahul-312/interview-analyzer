"""
Emails about billing events. Razorpay also emails customers about charges and failures
(customer_notify is on), so these are off unless BILLING_EMAILS is set, and a failure to send
never affects billing.
"""
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from . import entitlements, tiers
from .models import PaymentTransaction, SubscriptionStatus, UserSubscription

logger = logging.getLogger(__name__)

_MESSAGES = {
    "activated": ("Your {plan} plan is active", "Thanks for subscribing. Your {plan} plan is active."),
    "renewed": ("Your {plan} plan was renewed", "Your {plan} plan was renewed. It's paid until {end}."),
    "payment_failed": (
        "Payment for your {plan} plan failed",
        "We couldn't charge you for your {plan} plan. We'll retry; to update your payment method, go to Plans & billing.",
    ),
    "halted": (
        "Your {plan} plan is on hold",
        "We couldn't charge you for your {plan} plan after several attempts, so paid features are paused. "
        "Go to Plans & billing to pay and restore them.",
    ),
    "cancel_scheduled": ("Your {plan} plan will end on {end}", "Your {plan} plan is cancelled. You keep it until {end}."),
    "cancelled": ("Your {plan} plan has ended", "Your {plan} plan has ended. {refund}{after}"),
    "upcoming_cancelled": (
        "Your new {plan} subscription is cancelled",
        "Your {plan} subscription that was due to start won't start, and you won't be charged for it. "
        "Your current plan isn't affected.",
    ),
}


def _after_cancel(sub):
    """What the user has now that `sub` has ended: a subscription about to start, another plan, or Free."""
    upcoming = (
        UserSubscription.objects.filter(
            user=sub.user, status=SubscriptionStatus.AUTHENTICATED, start_at__gt=timezone.now()
        )
        .exclude(pk=sub.pk).select_related("plan").order_by("start_at").first()
    )
    if upcoming:
        start = timezone.localtime(upcoming.start_at).strftime("%d %b %Y")
        return f"Your {upcoming.plan.get_tier_display()} subscription starts on {start}."
    current = entitlements.tier_for(sub.user)
    if current != tiers.FREE:
        return f"Your account is on {tiers.NAMES[current]}."
    return "Your account is back on Free."


def _refund_text(sub):
    """The money-back refund started with the cancellation, if any."""
    refunding = sub.payments.exclude(
        refund_status__in=[PaymentTransaction.RefundStatus.NONE, PaymentTransaction.RefundStatus.FAILED]
    )
    total = sum(p.amount_paise for p in refunding)
    if not total:
        return ""
    return (f"We're refunding ₹{total / 100:g} to your original payment method. "
            "It usually arrives within 5–7 working days. ")


def notify(sub, kind):
    if kind not in _MESSAGES:
        return
    logger.info("Billing event %s for subscription %s", kind, sub.razorpay_subscription_id)
    if not getattr(settings, "BILLING_EMAILS", False) or not sub.user.email:
        return
    try:
        end = timezone.localtime(sub.current_end).strftime("%d %b %Y") if sub.current_end else "the end of the period"
        after = _after_cancel(sub) if kind == "cancelled" else ""
        refund = _refund_text(sub) if kind == "cancelled" else ""
        subject, body = (
            text.format(plan=sub.plan.get_tier_display(), end=end, after=after, refund=refund) for text in _MESSAGES[kind]
        )
        send_mail(subject, body, None, [sub.user.email])
    except Exception:  # never let email break a request or webhook; billing is already saved
        logger.exception("Couldn't send billing email %s", kind)
