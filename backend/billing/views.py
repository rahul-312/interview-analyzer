import hashlib
import json
import logging

from django.conf import settings
from django.core.cache import cache
from redis.exceptions import RedisError
from rest_framework import serializers, status
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import Profile
from tracker.usage import usage

from . import entitlements, razorpay, services, tiers, webhooks
from .models import PaymentTransaction, SubscriptionStatus, TERMINAL_STATUSES, WebhookEvent
from .serializers import (
    CancelSerializer,
    PaymentSerializer,
    PlanCodeSerializer,
    PriceSerializer,
    SubscriptionSerializer,
    VerifySerializer,
    plans_data,
    tier_data,
)

logger = logging.getLogger(__name__)

PLANS_CACHE_KEY = "billing:plans"
PLANS_CACHE_SECONDS = 60


def billing_error(exc):
    return Response({"detail": exc.message, "code": exc.code}, status=exc.status)


def current_data(user):
    """The user's plan, subscription and the actions open to them. Everything the dashboard shows."""
    tier = entitlements.for_user(user)
    sub = services.current_subscription(user)
    upcoming = services.upcoming_subscription(user, sub)
    has_access = bool(sub and entitlements.gives_access(sub))
    active = has_access and sub.status == SubscriptionStatus.ACTIVE
    paid_ai = any(entitlements.ai_ready(code) for code in tiers.RANK if code != tiers.FREE)
    open_ = bool(sub and sub.status not in TERMINAL_STATUSES)
    comp = Profile.objects.filter(user=user).values_list("plan", flat=True).first() or "free"
    offer = services.refund_offer(user, sub) if open_ else None
    return {
        "plan": tier_data(tier),
        # Where the plan comes from: a subscription, a complimentary plan set by an admin, or neither.
        "source": "subscription" if sub and entitlements.gives_access(sub) and sub.tier == tier.code
        else ("complimentary" if comp == tier.code and tier.paid else "free"),
        "subscription": SubscriptionSerializer(sub).data if sub else None,
        "upcoming": SubscriptionSerializer(upcoming).data if upcoming else None,
        "actions": {
            # The same rule checkout applies.
            "subscribe": paid_ai and services.checkout_blocker(user) is None,
            "change_plan": active and not sub.cancel_at_period_end,
            "cancel": open_ and not sub.cancel_at_period_end,
            "cancel_upcoming": upcoming is not None,
            "cancel_at_period_end": active and not sub.cancel_at_period_end,
            "resume": bool(sub and sub.status == SubscriptionStatus.PAUSED),
            "pay": bool(sub and sub.status in (SubscriptionStatus.PENDING, SubscriptionStatus.HALTED) and sub.short_url),
        },
        # What cancelling now would refund (the money-back window), or null.
        "refund": {
            "amount_paise": offer.amount_paise,
            "currency": offer.currency,
            "until": serializers.DateTimeField().to_representation(offer.until),
        } if offer else None,
        "refund_days": settings.BILLING_REFUND_DAYS,
        "billing_enabled": razorpay.enabled(),
        "usage": usage(user),
    }


class PaymentsUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Payments aren't set up on this server."
    default_code = "billing_disabled"


class BillingActionView(APIView):
    """Signed-in billing calls that reach Razorpay: throttled, and unavailable until it's configured."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "billing"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not razorpay.enabled():
            raise PaymentsUnavailable()


class PlansView(APIView):
    """GET: every plan, what it includes and its prices. Public, for the pricing page, so it's cached briefly."""
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            return Response(cache.get_or_set(PLANS_CACHE_KEY, self.plans, PLANS_CACHE_SECONDS))
        except RedisError:
            # The cache only saves work: the pricing page shouldn't go down with it
            logger.warning("Plans cache unavailable", exc_info=True)
            return Response(self.plans())

    @staticmethod
    def plans():
        return {
            "tiers": plans_data(),
            "billing_enabled": razorpay.enabled(),
            "grace_days": settings.BILLING_GRACE_DAYS,
            "refund_days": settings.BILLING_REFUND_DAYS,
        }


class CurrentSubscriptionView(APIView):
    """GET: the user's plan, subscription, usage and what they can do next."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(current_data(request.user))


class UsageView(APIView):
    """GET: what's left of each limited AI job in the rolling 24 hours."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(usage(request.user))


class PaymentsView(APIView):
    """GET: the user's last 50 payments."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        payments = PaymentTransaction.objects.filter(user=request.user).select_related("subscription__plan")[:50]
        return Response(PaymentSerializer(payments, many=True).data)


class CheckoutView(BillingActionView):
    """POST {"plan": "pro_monthly"}: creates the Razorpay subscription and returns what Checkout needs."""

    def post(self, request):
        serializer = PlanCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sub = services.start_checkout(request.user, serializer.validated_data["plan"])
        except services.BillingError as exc:
            return billing_error(exc)
        return Response(checkout_config(request.user, sub), status=status.HTTP_201_CREATED)


def checkout_config(user, sub):
    """What Razorpay Checkout needs to pay for the subscription the server created."""
    return {
        "key_id": settings.RAZORPAY_KEY_ID,
        "subscription_id": sub.razorpay_subscription_id,
        "plan": sub.plan.code,
        "name": "Interview Analyzer",
        "description": str(sub.plan),
        "starts_at": sub.start_at.isoformat() if sub.start_at else None,
        "prefill": {"name": user.first_name or user.username, "email": user.email},
    }


class VerifyView(BillingActionView):
    """POST Checkout's response: checks its signature, then syncs the subscription from Razorpay."""

    def post(self, request):
        serializer = VerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            services.verify_checkout(
                request.user,
                payment_id=data["razorpay_payment_id"],
                subscription_id=data["razorpay_subscription_id"],
                signature=data["razorpay_signature"],
            )
        except services.BillingError as exc:
            return billing_error(exc)
        return Response(current_data(request.user))


class UpgradeQuoteView(BillingActionView):
    """
    GET ?plan=pro_plus_monthly: what upgrading would do, for the confirmation dialog. "native_change"
    moves the subscription to the new plan and Razorpay bills it by its own rules. "replacement" pays
    for the new plan in Checkout (charge_paise), then refunds about credit_paise of the current one:
    the final credit is worked out when the new plan starts. credit_reason says why there's none:
    "below_minimum", "no_payment", or "too_old" (the upgrade is refused; available is false).
    Throttled, and unavailable without Razorpay keys, like the change it's for.
    """

    def get(self, request):
        serializer = PlanCodeSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        try:
            quote = services.upgrade_quote(request.user, serializer.validated_data["plan"])
        except services.BillingError as exc:
            return billing_error(exc)
        credit = quote.credit
        return Response({
            "strategy": quote.strategy,
            "plan": PriceSerializer(quote.plan).data,
            "available": not (credit and credit.reason == "too_old"),
            "charge_paise": quote.plan.price_paise if credit else None,
            "credit_paise": credit.amount_paise if credit and credit.refundable else 0,
            "credit_reason": credit.reason if credit else "",
            "currency": quote.plan.currency,
        })


class ChangePlanView(BillingActionView):
    """
    POST {"plan": "pro_plus_monthly"}: upgrade now, or downgrade at the end of the cycle. An upgrade
    that replaces the subscription (UPI Autopay, eMandate) returns change "checkout" and the
    Checkout config to pay for it; nothing changes until it's paid.
    """

    def post(self, request):
        serializer = PlanCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sub, change = services.change_plan(request.user, serializer.validated_data["plan"])
        except services.BillingError as exc:
            return billing_error(exc)
        data = {**current_data(request.user), "change": change}
        if change == "checkout":
            data["checkout"] = checkout_config(request.user, sub)
        return Response(data)


class CancelView(BillingActionView):
    """
    POST {"at_period_end": true}: cancel at the end of the paid period (default) or now. Now, inside
    the money-back window, also refunds the subscription; with "expect_refund": true cancelling now is refused
    (409 refund_window_closed) if the window has closed since the user was offered the refund.
    POST {"upcoming": true}: cancel the subscription bought to start when the current one ends.
    """

    def post(self, request):
        serializer = CancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            _, refunded, refund_failed = services.cancel(
                request.user, at_period_end=data["at_period_end"], upcoming=data["upcoming"], expect_refund=data["expect_refund"],
            )
        except services.BillingError as exc:
            return billing_error(exc)
        return Response({
            **current_data(request.user),
            "refunded": {"amount_paise": refunded.amount_paise, "currency": refunded.currency} if refunded else None,
            # Razorpay refused a refund on the spot: support has to make it.
            "refund_failed": refund_failed,
        })


class ResumeView(BillingActionView):
    """POST: resume a paused subscription, or get the link to pay a failed charge."""

    def post(self, request):
        try:
            _, payment_url = services.resume(request.user)
        except services.BillingError as exc:
            return billing_error(exc)
        return Response({**current_data(request.user), "payment_url": payment_url})


class RazorpayWebhookView(APIView):
    """
    POST from Razorpay. The signature is checked against the raw body before anything is parsed.
    2xx tells Razorpay to stop; a 500 (processing failed) makes it retry later.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.body
        if not razorpay.verify_webhook_signature(body, request.headers.get("X-Razorpay-Signature", "")):
            logger.warning("Rejected a Razorpay webhook with a bad signature")
            return Response({"detail": "Invalid signature."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = json.loads(body)
        except ValueError:
            return Response({"detail": "Invalid JSON."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(data, dict):
            return Response({"detail": "Invalid event."}, status=status.HTTP_400_BAD_REQUEST)
        # Razorpay sends a unique ID per event, but it isn't signed: the body's hash catches a replay under a new one.
        body_sha256 = hashlib.sha256(body).hexdigest()
        event_id = request.headers.get("X-Razorpay-Event-Id") or "sha256:" + body_sha256[:56]
        event = webhooks.handle(event_id, data, body_sha256=body_sha256)
        if event.status == WebhookEvent.Status.FAILED:
            return Response({"detail": "Processing failed."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({"status": event.status})
