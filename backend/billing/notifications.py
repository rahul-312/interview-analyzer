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
    "upgraded": (
        "You're now on {plan}",
        "Your upgrade to {plan} is done, and your previous plan has ended. {refund}",
    ),
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


def _refund_text(sub, what=""):
    """The refunds started for `sub`'s payments, if any: the money-back refund, or an upgrade's credit."""
    refunding = list(sub.payments.exclude(
        refund_status__in=[PaymentTransaction.RefundStatus.NONE, PaymentTransaction.RefundStatus.FAILED]
    ))
    total = sum(p.refund_paise for p in refunding)
    if not total:
        return ""
    return (f"We're refunding {money(total, refunding[0].currency)}{what} to your original payment method. "
            "It usually arrives within 5–7 working days. ")


def money(paise, currency="INR"):
    """₹1,699 or ₹12,345.67; other currencies by their code."""
    amount = f"{paise / 100:,.2f}".removesuffix(".00")
    return f"₹{amount}" if currency == "INR" else f"{currency} {amount}"


def notify(sub, kind):
    if kind not in _MESSAGES:
        return
    logger.info("Billing event %s for subscription %s", kind, sub.razorpay_subscription_id)
    if not getattr(settings, "BILLING_EMAILS", False) or not sub.user.email:
        return
    try:
        end = timezone.localtime(sub.current_end).strftime("%d %b %Y") if sub.current_end else "the end of the period"
        after = _after_cancel(sub) if kind == "cancelled" else ""
        if kind == "cancelled":
            refund = _refund_text(sub)
        elif kind == "upgraded" and sub.replaces_id:
            refund = _refund_text(sub.replaces, " for the unused days of your previous plan")
            if sub.credit_reason in ("too_old", "no_period"):  # left for someone to credit by hand
                refund += "We'll be in touch about the unused days of your previous plan."
        else:
            refund = ""
        subject, body = (
            text.format(plan=sub.plan.get_tier_display(), end=end, after=after, refund=refund) for text in _MESSAGES[kind]
        )
        send_mail(subject, body, None, [sub.user.email])
    except Exception:  # never let email break a request or webhook; billing is already saved
        logger.exception("Couldn't send billing email %s", kind)
