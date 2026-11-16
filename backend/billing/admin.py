from django.contrib import admin

from .models import PaymentTransaction, SubscriptionPlan, UserSubscription, WebhookEvent


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["code", "tier", "interval", "price_paise", "razorpay_plan_id", "is_active"]
    list_filter = ["tier", "interval", "is_active"]


@admin.register(UserSubscription)
class UserSubscriptionAdmin(admin.ModelAdmin):
    """Read-only: subscription state comes from Razorpay. Fix a wrong one with `manage.py reconcile_subscriptions`."""
    list_display = ["user", "plan", "status", "current_end", "cancel_at_period_end", "replacement_status", "razorpay_subscription_id"]
    # "Needs attention": an upgrade Razorpay refused to finish, see replacement_error.
    list_filter = ["status", "plan", "replacement_status"]
    search_fields = ["user__username", "user__email", "razorpay_subscription_id"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(admin.ModelAdmin):
    list_display = ["razorpay_payment_id", "user", "amount_paise", "status", "refund_status", "refund_reason", "method", "paid_at", "created_at"]
    list_filter = ["status", "refund_status", "refund_reason", "method"]
    search_fields = ["razorpay_payment_id", "user__username", "user__email"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False


@admin.register(WebhookEvent)
class WebhookEventAdmin(admin.ModelAdmin):
    list_display = ["event_id", "event_type", "status", "attempts", "received_at", "processed_at"]
    list_filter = ["status", "event_type"]
    search_fields = ["event_id"]
    readonly_fields = [f.name for f in WebhookEvent._meta.fields]

    def has_add_permission(self, request):
        return False
