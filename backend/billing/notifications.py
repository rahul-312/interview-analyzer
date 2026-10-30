"""
Emails about billing events. Razorpay also emails customers about charges and failures
(customer_notify is on), so these are off unless BILLING_EMAILS is set, and a failure to send
never affects billing.
"""
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

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
    "cancelled": ("Your {plan} plan has ended", "Your {plan} plan has ended and your account is back on Free."),
}


def notify(sub, kind):
    if kind not in _MESSAGES:
        return
    logger.info("Billing event %s for subscription %s", kind, sub.razorpay_subscription_id)
    if not getattr(settings, "BILLING_EMAILS", False) or not sub.user.email:
        return
    end = timezone.localtime(sub.current_end).strftime("%d %b %Y") if sub.current_end else "the end of the period"
    subject, body = (text.format(plan=sub.plan.get_tier_display(), end=end) for text in _MESSAGES[kind])
    try:
        send_mail(subject, body, None, [sub.user.email])
    except Exception:  # never let email break a webhook
        logger.exception("Couldn't send billing email %s", kind)
