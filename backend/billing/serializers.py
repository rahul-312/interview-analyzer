from rest_framework import serializers

from . import entitlements, tiers
from .models import PaymentTransaction, SubscriptionPlan, UserSubscription


def tier_data(tier):
    """What a tier includes, for the pricing page and the current-plan view."""
    return {
        "code": tier.code,
        "name": tier.name,
        "analyses_per_24h": tier.analyses_per_24h,
        "analyses_fair_use": tier.analyses_fair_use,
        "prep_plans_per_24h": tier.prep_plans_per_24h,
        "ai_model": tier.ai_model_label,
        "priority_queue": tier.priority,
        "debriefs_used_for_training": tier.debriefs_may_train,
        "rule_based_fallback": tier.rule_based_fallback,
        "usage_tracking": tier.usage_tracking,
        "browser_extension": tier.browser_extension,
    }


class PriceSerializer(serializers.ModelSerializer):
    available = serializers.BooleanField(read_only=True)

    class Meta:
        model = SubscriptionPlan
        fields = ["code", "tier", "interval", "price_paise", "currency", "available"]


def plans_data():
    prices = list(SubscriptionPlan.objects.filter(is_active=True))
    return [
        {**tier_data(tier), "prices": PriceSerializer([p for p in prices if p.tier == tier.code], many=True).data}
        for tier in tiers.all_tiers()
    ]


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PriceSerializer(read_only=True)
    scheduled_plan = PriceSerializer(read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    # When paid access ends (null while it renews normally).
    access_until = serializers.SerializerMethodField()
    gives_access = serializers.SerializerMethodField()

    class Meta:
        model = UserSubscription
        fields = [
            "plan", "interval", "status", "status_label", "gives_access", "start_at", "current_start", "current_end",
            "next_charge_at", "ended_at", "cancel_at_period_end", "cancel_requested_at", "scheduled_plan",
            "scheduled_change_at", "access_until", "created_at",
        ]

    def get_access_until(self, sub):
        if sub.status == "active" and not sub.cancel_at_period_end:
            return None
        end = entitlements.access_until(sub)
        return serializers.DateTimeField().to_representation(end) if end else None

    def get_gives_access(self, sub):
        return entitlements.gives_access(sub)


class PaymentSerializer(serializers.ModelSerializer):
    plan = serializers.CharField(source="subscription.plan.code", default=None, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PaymentTransaction
        fields = [
            "id", "razorpay_payment_id", "plan", "amount_paise", "currency", "status", "status_label", "method",
            "method_detail", "failure_reason", "paid_at", "created_at",
        ]


class PlanCodeSerializer(serializers.Serializer):
    plan = serializers.SlugField(max_length=40)


class VerifySerializer(serializers.Serializer):
    razorpay_payment_id = serializers.CharField(max_length=40)
    razorpay_subscription_id = serializers.CharField(max_length=40)
    razorpay_signature = serializers.CharField(max_length=128)


class CancelSerializer(serializers.Serializer):
    at_period_end = serializers.BooleanField(default=True)
