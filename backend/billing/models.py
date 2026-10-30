from django.conf import settings
from django.db import models
from django.db.models import Q

from . import tiers


class Interval(models.TextChoices):
    MONTH = "month", "Monthly"
    YEAR = "year", "Yearly"


class SubscriptionPlan(models.Model):
    """
    One way to pay for a paid tier: Pro or Pro Plus, monthly or yearly. What a tier includes is in
    billing.tiers; this holds the price and the matching Razorpay plan.

    Razorpay plans can't be edited, so a new price needs a new Razorpay plan: change price_paise,
    clear razorpay_plan_id and run `manage.py setup_razorpay_plans`. Existing subscribers keep
    paying what their Razorpay plan says.
    """

    class Tier(models.TextChoices):
        PRO = tiers.PRO, "Pro"
        PRO_PLUS = tiers.PRO_PLUS, "Pro Plus"

    code = models.SlugField(max_length=40, unique=True)  # e.g. "pro_monthly"
    tier = models.CharField(max_length=10, choices=Tier.choices)
    interval = models.CharField(max_length=10, choices=Interval.choices)
    # In paise (₹199 = 19900), so amounts are never floats.
    price_paise = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    # Different in test and live mode. Blank until set up in Razorpay.
    razorpay_plan_id = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["price_paise"]
        constraints = [
            models.UniqueConstraint(fields=["tier", "interval"], condition=Q(is_active=True), name="one_active_plan_per_tier_interval"),
            models.UniqueConstraint(fields=["razorpay_plan_id"], condition=~Q(razorpay_plan_id=""), name="unique_razorpay_plan_id"),
            models.CheckConstraint(condition=Q(price_paise__gt=0), name="plan_price_positive"),
        ]

    def __str__(self):
        return f"{self.get_tier_display()} {self.get_interval_display()} (₹{self.price_paise / 100:g})"

    @property
    def available(self):
        return self.is_active and bool(self.razorpay_plan_id)


class SubscriptionStatus(models.TextChoices):
    # Razorpay's subscription states, plus EXPIRED for a checkout that was never completed.
    CREATED = "created", "Awaiting checkout"
    AUTHENTICATED = "authenticated", "Authorised"
    ACTIVE = "active", "Active"
    PENDING = "pending", "Payment failed, retrying"
    HALTED = "halted", "Halted"
    PAUSED = "paused", "Paused"
    CANCELLED = "cancelled", "Cancelled"
    COMPLETED = "completed", "Completed"
    EXPIRED = "expired", "Expired"


# Razorpay never moves a subscription out of these, so events can't move ours out of them either.
TERMINAL_STATUSES = {SubscriptionStatus.CANCELLED, SubscriptionStatus.COMPLETED, SubscriptionStatus.EXPIRED}
# Past checkout and not ended: Razorpay can still charge these, or they can still be resumed.
OPEN_STATUSES = (
    SubscriptionStatus.AUTHENTICATED, SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING,
    SubscriptionStatus.HALTED, SubscriptionStatus.PAUSED,
)


class UserSubscription(models.Model):
    """
    A Razorpay subscription. Its state is only ever written from Razorpay: webhooks, or the API
    called server-side. A user can have several over time (and two at once: one cancelled at the
    end of its period and its replacement starting then); billing.entitlements picks the best.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    interval = models.CharField(max_length=10, choices=Interval.choices)
    razorpay_subscription_id = models.CharField(max_length=40, unique=True)
    razorpay_customer_id = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=15, choices=SubscriptionStatus.choices, default=SubscriptionStatus.CREATED)
    # Razorpay's link where the customer can pay again or change card after a failed charge.
    short_url = models.URLField(max_length=300, blank=True)
    # When billing starts (set for a subscription that replaces one being cancelled at period end).
    start_at = models.DateTimeField(null=True, blank=True)
    current_start = models.DateTimeField(null=True, blank=True)
    current_end = models.DateTimeField(null=True, blank=True)
    next_charge_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    # Cancellation asked for at the end of the current period: access lasts until current_end.
    cancel_at_period_end = models.BooleanField(default=False)
    cancel_requested_at = models.DateTimeField(null=True, blank=True)
    # A downgrade or interval change Razorpay will apply at the end of the cycle.
    scheduled_plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    scheduled_change_at = models.DateTimeField(null=True, blank=True)
    # When the checkout signature was verified (the payment itself is confirmed by Razorpay).
    checkout_verified_at = models.DateTimeField(null=True, blank=True)
    # Time of the newest Razorpay event applied, so an older one delivered late can't undo it.
    last_event_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "status"], name="subscription_user_status")]

    def __str__(self):
        return f"{self.user} {self.plan} ({self.status})"

    @property
    def tier(self):
        return self.plan.tier


class PaymentTransaction(models.Model):
    class Status(models.TextChoices):
        CREATED = "created", "Created"
        AUTHORIZED = "authorized", "Authorised"
        CAPTURED = "captured", "Paid"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="payments")
    subscription = models.ForeignKey(UserSubscription, on_delete=models.SET_NULL, null=True, blank=True, related_name="payments")
    razorpay_payment_id = models.CharField(max_length=40, unique=True)
    razorpay_order_id = models.CharField(max_length=40, blank=True)
    razorpay_invoice_id = models.CharField(max_length=40, blank=True)
    amount_paise = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=12, choices=Status.choices)
    # Only the kind of payment ("card", "upi"...) and, for cards, the network. Never card numbers.
    method = models.CharField(max_length=20, blank=True)
    method_detail = models.CharField(max_length=40, blank=True)
    failure_reason = models.CharField(max_length=300, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"], name="payment_user_created")]

    def __str__(self):
        return f"{self.razorpay_payment_id} ₹{self.amount_paise / 100:g} ({self.status})"


class WebhookEvent(models.Model):
    """A Razorpay webhook delivery, kept so a repeat of the same event is never applied twice."""

    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        PROCESSED = "processed", "Processed"
        IGNORED = "ignored", "Ignored"
        FAILED = "failed", "Failed"

    event_id = models.CharField(max_length=64, unique=True)
    # SHA-256 of the raw body. The event ID header isn't signed, so a captured body resent under a
    # new ID is caught by this instead.
    body_sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    event_type = models.CharField(max_length=60)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RECEIVED)
    # The event with customer contact details and payment instrument details removed, for reprocessing.
    payload = models.JSONField(default=dict)
    # Razorpay's created_at for the event.
    occurred_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    # The exception type and message only; never the payload.
    error = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-received_at"]
        indexes = [models.Index(fields=["status", "received_at"], name="webhook_status_received")]

    def __str__(self):
        return f"{self.event_type} {self.event_id} ({self.status})"
