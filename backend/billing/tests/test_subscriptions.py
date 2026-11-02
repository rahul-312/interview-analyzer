import time
from datetime import timedelta
from unittest import mock

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Profile
from billing import entitlements, notifications, razorpay, services, webhooks
from billing.checks import paid_plans_have_ai, signup_limit_is_shared
from billing.models import BillingLock, PaymentTransaction, SubscriptionPlan, SubscriptionStatus, UserSubscription, WebhookEvent

from .conftest import DAY, KEY_SECRET, checkout_signature, payment_entity, send_webhook

pytestmark = pytest.mark.django_db


def checkout(api, plan="pro_monthly"):
    res = api.post("/api/subscriptions/checkout/", {"plan": plan}, format="json")
    assert res.status_code == 201, res.data
    return res.data["subscription_id"]


def subscribe(api, anon, rzp, plan="pro_monthly", payment_id="pay_1"):
    """Checkout, then Razorpay's activation webhook. Returns the subscription ID."""
    sub_id = checkout(api, plan)
    entity = rzp.activate(sub_id)
    res = send_webhook(anon, "subscription.activated", subscription=entity)
    assert res.status_code == 200, res.data
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity(payment_id))
    return sub_id


def tier(api):
    return api.get("/api/subscriptions/current/").data["plan"]["code"]


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

def test_new_users_are_on_free(api, user):
    data = api.get("/api/subscriptions/current/").data
    assert data["plan"]["code"] == "free" and data["subscription"] is None
    assert data["actions"]["subscribe"] is True
    assert Profile.objects.get(user=user).plan == "free"


def test_plans_are_public_and_list_every_tier(anon, plans):
    data = anon.get("/api/subscriptions/plans/").data
    by_code = {t["code"]: t for t in data["tiers"]}
    assert list(by_code) == ["free", "pro", "pro_plus"]
    assert by_code["free"]["prices"] == []
    assert {p["code"]: p["price_paise"] for p in by_code["pro"]["prices"]} == {"pro_monthly": 19900, "pro_yearly": 169900}
    assert {p["code"]: p["price_paise"] for p in by_code["pro_plus"]["prices"]} == {
        "pro_plus_monthly": 49900, "pro_plus_yearly": 399900,
    }
    assert (by_code["free"]["analyses_per_24h"], by_code["pro"]["analyses_per_24h"], by_code["pro_plus"]["analyses_per_24h"]) == (2, 15, 50)
    assert (by_code["free"]["prep_plans_per_24h"], by_code["pro"]["prep_plans_per_24h"], by_code["pro_plus"]["prep_plans_per_24h"]) == (1, 5, 15)
    assert by_code["pro_plus"]["analyses_fair_use"] is True and by_code["pro"]["analyses_fair_use"] is False
    assert by_code["pro_plus"]["priority_queue"] is True and by_code["pro"]["priority_queue"] is False
    assert [t["debriefs_used_for_training"] for t in data["tiers"]] == [True, False, False]
    assert all(t["rule_based_fallback"] and t["usage_tracking"] and t["browser_extension"] for t in data["tiers"])


def test_plans_without_a_razorpay_plan_are_not_available(anon, db):
    prices = anon.get("/api/subscriptions/plans/").data["tiers"][1]["prices"]
    assert all(p["available"] is False for p in prices)


# ---------------------------------------------------------------------------
# Checkout and verification
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("plan", ["pro_monthly", "pro_yearly", "pro_plus_monthly", "pro_plus_yearly"])
def test_checkout_creates_a_subscription_for_each_paid_plan(api, user, plans, rzp, plan):
    res = api.post("/api/subscriptions/checkout/", {"plan": plan}, format="json")
    assert res.status_code == 201
    assert res.data["key_id"] == "rzp_test_key"
    assert KEY_SECRET not in str(res.data)
    method, path, payload = rzp.calls[-1]
    assert (method, path) == ("POST", "/subscriptions")
    assert payload["plan_id"] == f"plan_{plan}"  # from the server's plan table, not the request
    assert payload["total_count"] == (120 if plan.endswith("monthly") else 10)
    sub = UserSubscription.objects.get(razorpay_subscription_id=res.data["subscription_id"])
    assert sub.user == user and sub.status == "created" and sub.plan.code == plan
    assert tier(api) == "free"  # nothing until Razorpay confirms payment


def test_repeated_checkout_reuses_the_subscription(api, plans, rzp):
    first = checkout(api)
    second = checkout(api)
    assert first == second
    assert sum(1 for c in rzp.calls if c[:2] == ("POST", "/subscriptions")) == 1


def test_checkout_rejects_unknown_and_inactive_plans(api, plans, rzp):
    assert api.post("/api/subscriptions/checkout/", {"plan": "enterprise"}, format="json").status_code == 400
    SubscriptionPlan.objects.filter(code="pro_monthly").update(is_active=False)
    assert api.post("/api/subscriptions/checkout/", {"plan": "pro_monthly"}, format="json").status_code == 400
    assert api.post("/api/subscriptions/checkout/", {}, format="json").status_code == 400
    assert rzp.calls == []


def test_checkout_ignores_a_price_sent_by_the_browser(api, plans, rzp):
    api.post("/api/subscriptions/checkout/", {"plan": "pro_monthly", "price_paise": 1, "plan_id": "plan_evil"}, format="json")
    assert rzp.calls[-1][2]["plan_id"] == "plan_pro_monthly"


def test_billing_endpoints_need_login(anon, plans):
    for path in ("current/", "usage/", "payments/", "checkout/", "verify/", "change-plan/", "cancel/", "resume/"):
        method = anon.get if path in ("current/", "usage/", "payments/") else anon.post
        assert method(f"/api/subscriptions/{path}").status_code == 401, path


def test_checkout_is_unavailable_without_razorpay_keys(api, plans, settings):
    settings.RAZORPAY_KEY_ID = ""
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_monthly"}, format="json")
    assert res.status_code == 503
    assert api.get("/api/subscriptions/plans/").data["billing_enabled"] is False


def test_verify_with_valid_signature_activates_from_razorpay_state(api, plans, rzp):
    sub_id = checkout(api)
    rzp.activate(sub_id)
    res = api.post("/api/subscriptions/verify/", {
        "razorpay_payment_id": "pay_1", "razorpay_subscription_id": sub_id,
        "razorpay_signature": checkout_signature("pay_1", sub_id),
    }, format="json")
    assert res.status_code == 200
    assert res.data["plan"]["code"] == "pro"
    assert UserSubscription.objects.get(razorpay_subscription_id=sub_id).checkout_verified_at is not None


def test_verify_does_not_grant_access_until_razorpay_says_active(api, plans, rzp):
    sub_id = checkout(api)
    rzp.subscriptions[sub_id]["status"] = "authenticated"  # mandate set up, not charged yet
    res = api.post("/api/subscriptions/verify/", {
        "razorpay_payment_id": "pay_1", "razorpay_subscription_id": sub_id,
        "razorpay_signature": checkout_signature("pay_1", sub_id),
    }, format="json")
    assert res.status_code == 200 and res.data["plan"]["code"] == "free"
    assert res.data["subscription"]["status"] == "authenticated"


def test_verify_rejects_a_bad_signature(api, plans, rzp):
    sub_id = checkout(api)
    rzp.activate(sub_id)
    res = api.post("/api/subscriptions/verify/", {
        "razorpay_payment_id": "pay_1", "razorpay_subscription_id": sub_id, "razorpay_signature": "0" * 64,
    }, format="json")
    assert res.status_code == 400 and res.data["code"] == "invalid_signature"
    assert tier(api) == "free"


def test_verify_cannot_touch_another_users_subscription(api, other_user, plans, rzp):
    from rest_framework.test import APIClient

    sub_id = checkout(api)
    rzp.activate(sub_id)
    bob = APIClient()
    bob.force_authenticate(other_user)
    res = bob.post("/api/subscriptions/verify/", {
        "razorpay_payment_id": "pay_1", "razorpay_subscription_id": sub_id,
        "razorpay_signature": checkout_signature("pay_1", sub_id),
    }, format="json")
    assert res.status_code == 404
    assert tier(bob) == "free"


def test_signature_check():
    import hashlib
    import hmac

    from django.test import override_settings

    with override_settings(RAZORPAY_KEY_SECRET="s3cret"):
        good = hmac.new(b"s3cret", b"pay_A|sub_B", hashlib.sha256).hexdigest()
        assert razorpay.verify_checkout_signature(payment_id="pay_A", subscription_id="sub_B", signature=good)
        assert not razorpay.verify_checkout_signature(payment_id="pay_A", subscription_id="sub_C", signature=good)
        assert not razorpay.verify_checkout_signature(payment_id="", subscription_id="sub_B", signature=good)


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

def test_webhook_with_bad_signature_is_rejected(api, anon, plans, rzp):
    sub_id = checkout(api)
    res = send_webhook(anon, "subscription.activated", subscription=rzp.activate(sub_id), secret="wrong")
    assert res.status_code == 400
    assert WebhookEvent.objects.count() == 0
    assert tier(api) == "free"


def test_activation_webhook_grants_the_plan_and_records_the_payment(api, anon, plans, rzp):
    subscribe(api, anon, rzp, "pro_plus_yearly")
    data = api.get("/api/subscriptions/current/").data
    assert data["plan"]["code"] == "pro_plus" and data["source"] == "subscription"
    assert data["subscription"]["interval"] == "year" and data["subscription"]["next_charge_at"]
    payment = PaymentTransaction.objects.get()
    assert payment.status == "captured" and payment.amount_paise == 19900 and payment.paid_at
    assert payment.method == "card" and payment.method_detail == "Visa"


def test_duplicate_webhooks_are_applied_once(api, anon, plans, rzp):
    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    for _ in range(3):
        res = send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_1"), event_id="evt_same")
        assert res.status_code == 200
    # Same payment in a different event (payment.captured) doesn't make a second row either.
    send_webhook(anon, "payment.captured", payment=payment_entity("pay_1", subscription_id=sub_id))
    assert PaymentTransaction.objects.count() == 1
    event = WebhookEvent.objects.get(event_id="evt_same")
    assert event.attempts == 1 and event.status == "processed"


def test_stored_events_have_no_contact_or_card_details(api, anon, plans, rzp):
    sub_id = checkout(api)
    send_webhook(anon, "subscription.charged", subscription=rzp.activate(sub_id), payment=payment_entity("pay_1"))
    stored = str(WebhookEvent.objects.get().payload)
    assert "alice@example.com" not in stored and "+9199" not in stored and "1111" not in stored


def test_out_of_order_events_dont_undo_newer_state(api, anon, plans, rzp):
    sub_id = checkout(api)
    now = int(time.time())
    active = rzp.activate(sub_id)
    send_webhook(anon, "subscription.activated", subscription=active, created_at=now)
    # The older "authenticated" event arrives late.
    send_webhook(anon, "subscription.authenticated", subscription={**active, "status": "authenticated"}, created_at=now - 60)
    assert UserSubscription.objects.get().status == "active"
    assert tier(api) == "pro"


def test_ended_subscription_is_never_revived(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    entity = rzp.subscriptions[sub_id]
    send_webhook(anon, "subscription.cancelled", subscription={**entity, "status": "cancelled"})
    send_webhook(anon, "subscription.activated", subscription={**entity, "status": "active"}, created_at=int(time.time()) + 5)
    assert UserSubscription.objects.get().status == "cancelled"
    assert tier(api) == "free"


def test_events_for_unknown_subscriptions_are_ignored(anon, plans):
    res = send_webhook(anon, "subscription.activated", subscription={"id": "sub_elsewhere", "status": "active", "plan_id": "plan_pro_monthly"})
    assert res.status_code == 200 and res.data["status"] == "ignored"
    assert UserSubscription.objects.count() == 0


def test_failed_event_is_retried(api, anon, plans, rzp, monkeypatch):
    from billing import webhooks

    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    real = webhooks.apply_snapshot

    def broken(*args, **kwargs):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(webhooks, "apply_snapshot", broken)
    assert send_webhook(anon, "subscription.activated", subscription=entity, event_id="evt_retry").status_code == 500
    assert WebhookEvent.objects.get().status == "failed" and tier(api) == "free"

    monkeypatch.setattr(webhooks, "apply_snapshot", real)
    assert send_webhook(anon, "subscription.activated", subscription=entity, event_id="evt_retry").status_code == 200
    event = WebhookEvent.objects.get()
    assert event.status == "processed" and event.attempts == 2 and event.error == ""
    assert tier(api) == "pro"


# ---------------------------------------------------------------------------
# Renewals, failures and recovery
# ---------------------------------------------------------------------------

def test_renewal_extends_the_period_and_records_the_charge(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    entity = rzp.subscriptions[sub_id]
    entity.update(current_start=entity["current_end"], current_end=entity["current_end"] + 30 * DAY)
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_2"), created_at=int(time.time()) + 1)
    sub = UserSubscription.objects.get()
    assert sub.current_end.timestamp() == entity["current_end"]
    assert list(PaymentTransaction.objects.values_list("razorpay_payment_id", flat=True).order_by("id")) == ["pay_1", "pay_2"]


def test_failed_renewal_keeps_access_through_the_grace_period_then_halts(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    ended = int(time.time()) - DAY  # the paid period ended yesterday
    entity = {**rzp.subscriptions[sub_id], "status": "pending", "current_end": ended}
    send_webhook(anon, "subscription.pending", subscription=entity,
                 payment=payment_entity("pay_2", status="failed", error_description="Card declined"), created_at=int(time.time()) + 1)
    data = api.get("/api/subscriptions/current/").data
    assert data["plan"]["code"] == "pro"  # within the 3-day grace period
    assert data["actions"]["pay"] is True
    assert data["actions"]["subscribe"] is False  # checkout would refuse a second subscription now
    assert PaymentTransaction.objects.get(razorpay_payment_id="pay_2").failure_reason == "Card declined"

    UserSubscription.objects.update(current_end=timezone.now() - timedelta(days=4))
    assert tier(api) == "free"  # grace period over

    send_webhook(anon, "subscription.halted", subscription={**entity, "status": "halted"}, created_at=int(time.time()) + 2)
    assert tier(api) == "free"
    res = api.post("/api/subscriptions/resume/")
    assert res.status_code == 200 and res.data["payment_url"] == f"https://rzp.io/i/{sub_id}"

    # The customer pays from the link: Razorpay reactivates the subscription.
    recovered = rzp.activate(sub_id)
    send_webhook(anon, "subscription.activated", subscription=recovered, created_at=int(time.time()) + 3)
    assert tier(api) == "pro"


def test_halted_subscription_has_no_access(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    send_webhook(anon, "subscription.halted", subscription={**rzp.subscriptions[sub_id], "status": "halted"}, created_at=int(time.time()) + 1)
    assert tier(api) == "free"


def test_active_subscription_long_past_its_period_loses_access(api, anon, plans, rzp):
    # Every renewal webhook missed: reconcile_subscriptions fixes it, but access doesn't run on forever.
    subscribe(api, anon, rzp)
    UserSubscription.objects.update(current_end=timezone.now() - timedelta(days=4))
    assert tier(api) == "free"


def test_reconcile_applies_razorpay_state(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    rzp.subscriptions[sub_id]["status"] = "halted"  # the webhook never arrived
    call_command("reconcile_subscriptions")
    assert UserSubscription.objects.get().status == "halted"


def test_reconcile_expires_abandoned_checkouts(api, plans, rzp):
    checkout(api)
    UserSubscription.objects.update(created_at=timezone.now() - timedelta(days=2))
    call_command("reconcile_subscriptions")
    assert UserSubscription.objects.get().status == "expired"


# ---------------------------------------------------------------------------
# Plan changes
# ---------------------------------------------------------------------------

def test_upgrade_applies_now(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp, "pro_monthly")
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 200 and res.data["change"] == "now"
    assert res.data["plan"]["code"] == "pro_plus"
    assert rzp.calls[-1] == ("PATCH", f"/subscriptions/{sub_id}", {
        "plan_id": "plan_pro_plus_monthly", "schedule_change_at": "now", "customer_notify": 1,
    })


def test_downgrade_waits_for_the_end_of_the_cycle(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp, "pro_plus_monthly")
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_monthly"}, format="json")
    assert res.status_code == 200 and res.data["change"] == "cycle_end"
    assert res.data["plan"]["code"] == "pro_plus"  # keeps what was paid for
    assert res.data["subscription"]["scheduled_plan"]["code"] == "pro_monthly"
    assert api.post("/api/subscriptions/change-plan/", {"plan": "pro_monthly"}, format="json").status_code == 409

    # At the end of the cycle Razorpay charges the new plan.
    entity = rzp.subscriptions[sub_id]
    entity.update(plan_id="plan_pro_monthly", has_scheduled_changes=False, current_start=entity["current_end"],
                  current_end=entity["current_end"] + 30 * DAY)
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_2"), created_at=int(time.time()) + 1)
    data = api.get("/api/subscriptions/current/").data
    assert data["plan"]["code"] == "pro" and data["subscription"]["scheduled_plan"] is None


def test_plan_change_is_refused_for_upi_subscriptions(api, anon, plans, rzp):
    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_1", method="upi"))
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "change_unsupported"
    assert not any(c[0] == "PATCH" for c in rzp.calls)


def test_plan_change_needs_an_active_subscription(api, plans, rzp):
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "no_active_subscription"


def test_razorpay_refusing_a_change_is_reported(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    rzp.fail_next = razorpay.RazorpayError("Subscription cannot be updated", status=400)
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["detail"] == "Subscription cannot be updated"
    assert tier(api) == "pro"


def test_checkout_while_subscribed_is_refused(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "already_subscribed"


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------

def test_cancel_at_period_end_keeps_access_until_then(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    res = api.post("/api/subscriptions/cancel/", {}, format="json")
    assert res.status_code == 200
    assert rzp.calls[-1] == ("POST", f"/subscriptions/{sub_id}/cancel", {"cancel_at_cycle_end": 1})
    sub = res.data["subscription"]
    assert sub["cancel_at_period_end"] is True and sub["access_until"] == sub["current_end"]
    assert res.data["plan"]["code"] == "pro"
    assert res.data["actions"]["cancel"] is False and res.data["actions"]["change_plan"] is False

    # No grace period after a cancellation: access ends with the period.
    UserSubscription.objects.update(current_end=timezone.now() - timedelta(minutes=1))
    assert tier(api) == "free"
    send_webhook(anon, "subscription.cancelled", subscription={**rzp.subscriptions[sub_id], "status": "cancelled"},
                 created_at=int(time.time()) + 1)
    assert UserSubscription.objects.get().status == "cancelled"


def test_cancel_now_ends_access_now(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200 and res.data["plan"]["code"] == "free"
    assert res.data["subscription"]["status"] == "cancelled"


def test_scheduled_cancellation_cant_be_undone_but_a_new_subscription_starts_after_it(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {}, format="json")
    res = api.post("/api/subscriptions/resume/")
    assert res.status_code == 409 and res.data["code"] == "cancellation_final"

    current_end = UserSubscription.objects.get().current_end
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_yearly"}, format="json")
    assert res.status_code == 201
    assert rzp.calls[-1][2]["start_at"] == int(current_end.timestamp())  # no double charge


# ---------------------------------------------------------------------------
# Money-back window
# ---------------------------------------------------------------------------

def refund_calls(rzp):
    return [c for c in rzp.calls if c[0] == "POST" and c[1].endswith("/refund")]


def test_the_dashboard_offers_a_refund_inside_the_window(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    paid_at = PaymentTransaction.objects.get().paid_at
    data = api.get("/api/subscriptions/current/").data
    assert data["refund_days"] == 7
    assert data["refund"]["amount_paise"] == 19900 and data["refund"]["currency"] == "INR"
    assert data["refund"]["until"] == (paid_at + timedelta(days=7)).isoformat().replace("+00:00", "Z")


def test_cancelling_now_inside_the_window_refunds_the_payment(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200 and res.data["plan"]["code"] == "free"
    assert res.data["refund"] is None
    assert res.data["refunded"] == {"amount_paise": 19900, "currency": "INR"}
    [(_, path, payload)] = refund_calls(rzp)
    assert path == "/payments/pay_1/refund" and payload["amount"] == 19900  # the whole payment
    assert payload["notes"]["reason"] == "money_back_window"
    payment = PaymentTransaction.objects.get()
    assert payment.refund_status == "pending" and payment.razorpay_refund_id.startswith("rfnd_")
    assert api.get("/api/subscriptions/payments/").data[0]["refund_status"] == "pending"


def test_cancelling_at_period_end_gives_up_the_refund(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    data = api.post("/api/subscriptions/cancel/", {}, format="json").data
    assert data["refunded"] is None and data["refund"] is None
    assert data["actions"]["cancel"] is False
    assert refund_calls(rzp) == []


def test_a_plan_bought_to_follow_a_period_end_cancel_doesnt_reopen_the_refund(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {}, format="json")
    new_id = checkout(api, "pro_plus_monthly")
    send_webhook(anon, "subscription.authenticated", subscription={**rzp.subscriptions[new_id], "status": "authenticated"},
                 created_at=int(time.time()) + 1)
    # Cancelling the first one now by calling the API directly: no refund, and the new one is untouched.
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False, "expect_refund": True}, format="json")
    assert res.status_code == 409 and res.data["code"] == "refund_window_closed"
    assert refund_calls(rzp) == []
    assert UserSubscription.objects.get(razorpay_subscription_id=new_id).status == "authenticated"


def test_a_refund_shown_after_the_window_closed_cancels_nothing(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    assert api.get("/api/subscriptions/current/").data["refund"] is not None  # the dialog opens with it
    PaymentTransaction.objects.update(paid_at=timezone.now() - timedelta(days=7, minutes=1))
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False, "expect_refund": True}, format="json")
    assert res.status_code == 409 and res.data["code"] == "refund_window_closed"
    assert not any(path == f"/subscriptions/{sub_id}/cancel" for _, path, _ in rzp.calls)
    assert UserSubscription.objects.get().status == "active"


def test_no_refund_after_the_window(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    PaymentTransaction.objects.update(paid_at=timezone.now() - timedelta(days=7, minutes=1))
    data = api.get("/api/subscriptions/current/").data
    assert data["refund"] is None
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200 and refund_calls(rzp) == []
    assert PaymentTransaction.objects.get().refund_status == ""


def test_the_window_can_be_turned_off(api, anon, plans, rzp, settings):
    settings.BILLING_REFUND_DAYS = 0
    subscribe(api, anon, rzp)
    assert api.get("/api/subscriptions/current/").data["refund"] is None
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert refund_calls(rzp) == []


def test_only_one_refund_per_user(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert len(refund_calls(rzp)) == 1

    subscribe(api, anon, rzp, payment_id="pay_2")
    assert api.get("/api/subscriptions/current/").data["refund"] is None
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert len(refund_calls(rzp)) == 1


def test_a_refund_made_in_the_dashboard_also_uses_up_the_window(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    PaymentTransaction.objects.update(status="refunded")
    assert api.get("/api/subscriptions/current/").data["refund"] is None


def test_the_refund_covers_an_upgrade_charge_too(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    send_webhook(anon, "subscription.charged", subscription=dict(rzp.subscriptions[sub_id]),
                 payment=payment_entity("pay_up", amount=30000), created_at=int(time.time()) + 1)
    assert api.get("/api/subscriptions/current/").data["refund"]["amount_paise"] == 49900
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert {c[1] for c in refund_calls(rzp)} == {"/payments/pay_1/refund", "/payments/pay_up/refund"}


def test_a_refund_razorpay_doesnt_take_is_retried_by_reconcile(api, anon, plans, rzp, monkeypatch):
    subscribe(api, anon, rzp)

    def unreachable(payment_id, *, notes):
        raise razorpay.RazorpayError("Couldn't reach the payment provider. Try again.")

    with monkeypatch.context() as m:
        m.setattr(razorpay, "refund_payment", unreachable)
        res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    # The cancellation stands, and the payment waits for its refund.
    assert res.status_code == 200 and res.data["subscription"]["status"] == "cancelled"
    assert PaymentTransaction.objects.get().refund_status == "requested"

    # Left alone at first: the cancel that requested it may still be making it.
    call_command("reconcile_subscriptions")
    assert refund_calls(rzp) == []
    PaymentTransaction.objects.update(refund_requested_at=timezone.now() - timedelta(minutes=11))
    call_command("reconcile_subscriptions")
    call_command("reconcile_subscriptions")
    assert len(refund_calls(rzp)) == 1
    assert PaymentTransaction.objects.get().refund_status == "pending"


def test_a_refund_made_before_a_crash_isnt_made_twice(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    # Razorpay refunded it, but the answer never got saved here.
    rzp.refunds["pay_1"] = [{"id": "rfnd_lost", "payment_id": "pay_1", "status": "processed", "amount": 19900,
                             "created_at": int(time.time())}]
    PaymentTransaction.objects.update(refund_status="requested", refund_requested_at=timezone.now() - timedelta(hours=1))
    call_command("reconcile_subscriptions")
    payment = PaymentTransaction.objects.get()
    assert refund_calls(rzp) == []
    assert (payment.razorpay_refund_id, payment.refund_status, payment.status) == ("rfnd_lost", "processed", "refunded")


def test_a_refund_made_by_another_attempt_meanwhile_isnt_made_twice(api, anon, plans, rzp, monkeypatch):
    subscribe(api, anon, rzp)
    PaymentTransaction.objects.update(refund_status="requested")
    # Another attempt refunds it between this one's check and its refund request.
    real_fetch = razorpay.fetch_refunds
    looks = iter([{"items": []}])

    def fetch(payment_id):
        try:
            answer = next(looks)
        except StopIteration:
            return real_fetch(payment_id)
        rzp.refunds["pay_1"] = [{"id": "rfnd_other", "payment_id": "pay_1", "status": "pending", "amount": 19900}]
        return answer

    monkeypatch.setattr(razorpay, "fetch_refunds", fetch)
    services.settle_refund(PaymentTransaction.objects.get())
    assert refund_calls(rzp) == [("POST", "/payments/pay_1/refund", mock.ANY)]  # refused by Razorpay
    payment = PaymentTransaction.objects.get()
    assert (payment.razorpay_refund_id, payment.refund_status) == ("rfnd_other", "pending")


def test_a_refund_razorpay_refuses_for_good_is_marked_failed(api, anon, plans, rzp, monkeypatch):
    subscribe(api, anon, rzp)

    def refused(payment_id, *, amount_paise, notes):
        raise razorpay.RazorpayError("The refund amount is greater than the amount left to refund", status=400)

    monkeypatch.setattr(razorpay, "refund_payment", refused)
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200
    assert res.data["refunded"] is None and res.data["refund_failed"] is True
    assert PaymentTransaction.objects.get().refund_status == "failed"
    assert api.get("/api/subscriptions/payments/").data[0]["refund_status"] == "failed"
    # Not retried: someone has to look at it in the Dashboard.
    PaymentTransaction.objects.update(refund_requested_at=timezone.now() - timedelta(hours=1))
    monkeypatch.setattr(razorpay, "refund_payment", lambda *a, **k: pytest.fail("retried a refused refund"))
    call_command("reconcile_subscriptions")


@pytest.mark.parametrize("status", [401, 403, 429])
def test_a_refund_razorpay_refuses_for_a_passing_reason_is_retried(api, anon, plans, rzp, monkeypatch, status):
    subscribe(api, anon, rzp)

    def refused(payment_id, *, amount_paise, notes):
        raise razorpay.RazorpayError("Too many requests" if status == 429 else "Authentication failed", status=status)

    with monkeypatch.context() as m:
        m.setattr(razorpay, "refund_payment", refused)
        res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200 and res.data["refund_failed"] is False
    assert res.data["refunded"]["amount_paise"] == 19900  # still on its way
    assert PaymentTransaction.objects.get().refund_status == "requested"
    PaymentTransaction.objects.update(refund_requested_at=timezone.now() - timedelta(minutes=11))
    call_command("reconcile_subscriptions")
    assert PaymentTransaction.objects.get().refund_status == "pending"


def test_reconcile_flags_refunds_stuck_for_over_an_hour(api, anon, plans, rzp, monkeypatch, capsys):
    subscribe(api, anon, rzp)
    PaymentTransaction.objects.update(refund_status="requested", refund_requested_at=timezone.now() - timedelta(hours=2))

    def bad_keys(payment_id):
        raise razorpay.RazorpayError("Authentication failed", status=401)

    monkeypatch.setattr(razorpay, "fetch_refunds", bad_keys)
    call_command("reconcile_subscriptions")
    out = capsys.readouterr()
    assert "1 refund(s) stuck: pay_1." in out.err and "stuck 1." in out.out


def test_reconcile_flags_refunds_razorpay_never_finished(api, anon, plans, rzp, capsys):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    call_command("reconcile_subscriptions")
    assert "stuck" not in capsys.readouterr().err  # pending, but only just
    PaymentTransaction.objects.update(refund_requested_at=timezone.now() - timedelta(days=11))
    call_command("reconcile_subscriptions")
    assert "1 refund(s) stuck: pay_1." in capsys.readouterr().err


def test_expect_refund_only_applies_to_cancelling_now(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    PaymentTransaction.objects.update(paid_at=timezone.now() - timedelta(days=30))
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": True, "expect_refund": True}, format="json")
    assert res.status_code == 200 and res.data["subscription"]["cancel_at_period_end"] is True


def test_an_unexpected_error_refunding_doesnt_fail_the_cancel(api, anon, plans, rzp, monkeypatch):
    subscribe(api, anon, rzp)

    def broken(payment):
        raise RuntimeError("database went away")

    monkeypatch.setattr(services, "settle_refund", broken)
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200 and res.data["subscription"]["status"] == "cancelled"
    assert PaymentTransaction.objects.get().refund_status == "requested"  # reconcile retries it


def test_a_partial_refund_in_the_dashboard_isnt_a_refund_here(api, anon, plans, rzp):
    subscribe(api, anon, rzp, plan="pro_plus_monthly")
    PaymentTransaction.objects.update(amount_paise=49900)
    partial = {"id": "rfnd_goodwill", "payment_id": "pay_1", "status": "processed", "amount": 5000}
    send_webhook(anon, "refund.processed", refund=partial, payment=payment_entity("pay_1", amount=49900))
    payment = PaymentTransaction.objects.get()
    assert (payment.refund_status, payment.status, payment.razorpay_refund_id) == ("", "captured", "")
    assert api.get("/api/subscriptions/current/").data["refund"]["amount_paise"] == 49900


def test_refund_webhooks_move_the_refund_forward_only(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    refund = rzp.refunds["pay_1"][0]
    now = int(time.time())
    send_webhook(anon, "refund.processed", refund={**refund, "status": "processed"},
                 payment=payment_entity("pay_1", status="refunded"), created_at=now + 5)
    send_webhook(anon, "refund.created", refund=refund, payment=payment_entity("pay_1"), created_at=now + 1)
    send_webhook(anon, "refund.failed", refund={**refund, "status": "failed"}, payment=payment_entity("pay_1"),
                 created_at=now + 2)
    payment = PaymentTransaction.objects.get()
    assert (payment.refund_status, payment.status) == ("processed", "refunded")
    assert api.get("/api/subscriptions/payments/").data[0]["status_label"] == "Refunded"


def test_a_failed_refund_is_flagged(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    refund = rzp.refunds["pay_1"][0]
    send_webhook(anon, "refund.failed", refund={**refund, "status": "failed"}, payment=payment_entity("pay_1"))
    assert PaymentTransaction.objects.get().refund_status == "failed"
    # Not retried automatically: a failed refund needs a look in the Dashboard.
    call_command("reconcile_subscriptions")
    assert len(refund_calls(rzp)) == 1


def test_the_cancelled_email_mentions_the_refund(
    api, anon, plans, rzp, settings, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    subscribe(api, anon, rzp)
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    body = _cancelled_email(mailoutbox)
    assert "We're refunding ₹199 to your original payment method." in body
    assert body.endswith("Your account is back on Free.")


@pytest.mark.parametrize("paise, currency, text", [
    (19900, "INR", "₹199"), (1234567, "INR", "₹12,345.67"), (100000000, "INR", "₹1,000,000"), (1999, "USD", "USD 19.99"),
])
def test_email_amounts(paise, currency, text):
    assert notifications.money(paise, currency) == text


def test_resume_with_nothing_to_resume(api, plans, rzp):
    assert api.post("/api/subscriptions/resume/").status_code == 409


def test_paused_subscription_can_be_resumed(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    send_webhook(anon, "subscription.paused", subscription={**rzp.subscriptions[sub_id], "status": "paused"},
                 created_at=int(time.time()) + 1)
    assert tier(api) == "free"
    res = api.post("/api/subscriptions/resume/")
    assert res.status_code == 200 and res.data["plan"]["code"] == "pro"


# ---------------------------------------------------------------------------
# Payments, ownership and complimentary plans
# ---------------------------------------------------------------------------

def test_payment_history_shows_only_the_users_own_payments(api, anon, other_user, plans, rzp):
    from rest_framework.test import APIClient

    subscribe(api, anon, rzp, payment_id="pay_alice")
    data = api.get("/api/subscriptions/payments/").data
    assert [p["razorpay_payment_id"] for p in data] == ["pay_alice"]
    assert data[0]["plan"] == "pro_monthly" and "1111" not in str(data)

    bob = APIClient()
    bob.force_authenticate(other_user)
    assert bob.get("/api/subscriptions/payments/").data == []
    assert bob.get("/api/subscriptions/current/").data["subscription"] is None


def test_complimentary_plan_from_the_admin(api, user, plans, rzp):
    Profile.objects.filter(user=user).update(plan="pro_plus")
    data = api.get("/api/subscriptions/current/").data
    assert data["plan"]["code"] == "pro_plus" and data["source"] == "complimentary"
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "already_included"


def test_best_of_two_subscriptions_wins(api, anon, user, plans, rzp):
    subscribe(api, anon, rzp, "pro_monthly")
    other = UserSubscription.objects.create(
        user=user, plan=plans["pro_plus_monthly"], interval="month", razorpay_subscription_id="sub_x",
        status=SubscriptionStatus.ACTIVE, current_end=timezone.now() + timedelta(days=5),
    )
    assert entitlements.entitled_subscription(user) == other
    assert tier(api) == "pro_plus"


def test_setup_razorpay_plans_creates_missing_plans(db, rzp, monkeypatch):
    monkeypatch.setenv("RAZORPAY_PLAN_PRO_YEARLY", "plan_from_env")
    call_command("setup_razorpay_plans")
    ids = dict(SubscriptionPlan.objects.values_list("code", "razorpay_plan_id"))
    assert ids["pro_yearly"] == "plan_from_env"
    assert all(ids.values())
    created = [c[2] for c in rzp.calls if c[1] == "/plans"]
    assert len(created) == 3
    assert all(c["interval"] == 1 and c["item"]["currency"] == "INR" for c in created)
    assert sorted(c["period"] for c in created) == ["monthly", "monthly", "yearly"]
    assert sorted(c["item"]["amount"] for c in created) == [19900, 49900, 399900]


# ---------------------------------------------------------------------------
# Only what can be delivered is sold
# ---------------------------------------------------------------------------

def test_paid_plans_arent_sold_without_a_paid_tier_ai_key(api, anon, plans, rzp, settings):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_PAID_API_KEY = ""
    by_code = {t["code"]: t for t in anon.get("/api/subscriptions/plans/").data["tiers"]}
    assert by_code["free"]["ai_model"] == "Flash" and by_code["free"]["ai_available"] is True
    assert by_code["pro"]["ai_model"] == "Rule-based engine" and by_code["pro"]["ai_available"] is False
    assert not any(p["available"] for p in by_code["pro"]["prices"] + by_code["pro_plus"]["prices"])

    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_monthly"}, format="json")
    assert res.status_code == 400 and res.data["code"] == "plan_unavailable"
    assert api.get("/api/subscriptions/current/").data["actions"]["subscribe"] is False
    assert rzp.calls == []


def test_deploy_check_warns_when_paid_plans_have_no_ai(settings):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_PAID_API_KEY = ""
    assert [w.id for w in paid_plans_have_ai(None)] == ["billing.W001"]
    settings.GEMINI_PAID_API_KEY = "paid-key"
    assert paid_plans_have_ai(None) == []


def test_deploy_check_warns_when_the_signup_limit_isnt_shared(settings):
    settings.DEBUG = False
    settings.VERTEX_API_KEY = "vertex-key"
    settings.CACHE_URL = ""
    assert [w.id for w in signup_limit_is_shared(None)] == ["billing.W002"]
    settings.CACHE_URL = "redis://localhost:6379/1"
    assert signup_limit_is_shared(None) == []
    settings.CACHE_URL = ""
    settings.DEBUG = True  # one dev server
    assert signup_limit_is_shared(None) == []


# ---------------------------------------------------------------------------
# One subscription that can be paid at a time
# ---------------------------------------------------------------------------

def test_a_new_checkout_cancels_an_unfinished_one_at_razorpay(api, plans, rzp):
    first = checkout(api, "pro_monthly")
    second = checkout(api, "pro_plus_monthly")
    assert ("POST", f"/subscriptions/{first}/cancel", {"cancel_at_cycle_end": 0}) in rzp.calls
    assert UserSubscription.objects.get(razorpay_subscription_id=first).status == "expired"
    assert UserSubscription.objects.get(razorpay_subscription_id=second).status == "created"


def test_a_new_checkout_waits_if_the_unfinished_one_was_paid_meanwhile(api, plans, rzp):
    first = checkout(api, "pro_monthly")
    rzp.subscriptions[first]["status"] = "authenticated"  # paid in another tab; its webhook hasn't arrived
    rzp.fail_next = razorpay.RazorpayError("Subscription can't be cancelled", status=400)
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "activation_pending"
    assert UserSubscription.objects.count() == 1


def test_checkout_is_refused_while_a_subscription_waits_for_payment(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    send_webhook(anon, "subscription.halted", subscription={**rzp.subscriptions[sub_id], "status": "halted"},
                 created_at=int(time.time()) + 1)
    actions = api.get("/api/subscriptions/current/").data["actions"]
    assert actions["subscribe"] is False and actions["pay"] is True
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "subscription_needs_attention"

    # Cancelling it clears the way.
    assert api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json").status_code == 200
    assert api.get("/api/subscriptions/current/").data["actions"]["subscribe"] is True


def test_upcoming_subscription_can_be_cancelled_before_it_starts(api, anon, plans, rzp):
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {}, format="json")
    new_id = checkout(api, "pro_yearly")
    send_webhook(anon, "subscription.authenticated", subscription={**rzp.subscriptions[new_id], "status": "authenticated"},
                 created_at=int(time.time()) + 1)
    data = api.get("/api/subscriptions/current/").data
    assert data["upcoming"]["plan"]["code"] == "pro_yearly"
    assert data["actions"]["cancel_upcoming"] is True and data["actions"]["subscribe"] is False

    res = api.post("/api/subscriptions/cancel/", {"upcoming": True}, format="json")
    assert res.status_code == 200 and res.data["upcoming"] is None
    assert rzp.calls[-1] == ("POST", f"/subscriptions/{new_id}/cancel", {"cancel_at_cycle_end": 0})
    assert UserSubscription.objects.get(razorpay_subscription_id=new_id).status == "cancelled"
    assert res.data["plan"]["code"] == "pro"  # the current one still runs to the end of its period


# ---------------------------------------------------------------------------
# Abandoned checkouts
# ---------------------------------------------------------------------------

def test_reconcile_cancels_abandoned_checkouts_at_razorpay(api, plans, rzp):
    sub_id = checkout(api)
    UserSubscription.objects.update(created_at=timezone.now() - timedelta(days=2))
    call_command("reconcile_subscriptions")
    assert rzp.subscriptions[sub_id]["status"] == "cancelled"  # its payment link is dead
    assert UserSubscription.objects.get().status == "expired"


def test_reconcile_doesnt_expire_a_checkout_that_was_paid(api, plans, rzp):
    sub_id = checkout(api)
    UserSubscription.objects.update(created_at=timezone.now() - timedelta(days=2))
    rzp.activate(sub_id)  # paid, but the webhooks were missed
    call_command("reconcile_subscriptions")
    assert UserSubscription.objects.get().status == "active" and tier(api) == "pro"
    assert not any(path.endswith("/cancel") for _, path, _ in rzp.calls)


def test_an_expired_checkout_follows_razorpay_if_it_was_paid_after_all(api, anon, plans, rzp):
    sub_id = checkout(api)
    UserSubscription.objects.update(status="expired")
    send_webhook(anon, "subscription.activated", subscription=rzp.activate(sub_id))
    assert tier(api) == "pro"


# ---------------------------------------------------------------------------
# Webhook edge cases
# ---------------------------------------------------------------------------

def test_a_replayed_body_under_a_new_event_id_is_not_applied(api, anon, plans, rzp):
    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    at = int(time.time())
    for event_id in ("evt_1", "evt_2"):
        res = send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_1", created_at=at),
                           created_at=at, event_id=event_id)
        assert res.status_code == 200
    assert list(WebhookEvent.objects.values_list("event_id", flat=True)) == ["evt_1"]


def test_a_stale_snapshot_that_disagrees_is_checked_with_razorpay(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    # This server's clock ran ahead, so a newer event looks older than the state applied last.
    UserSubscription.objects.update(last_event_at=timezone.now() + timedelta(minutes=5))
    rzp.subscriptions[sub_id]["status"] = "halted"
    send_webhook(anon, "subscription.halted", subscription=dict(rzp.subscriptions[sub_id]))
    assert rzp.calls[-1] == ("GET", f"/subscriptions/{sub_id}", None)
    assert UserSubscription.objects.get().status == "halted"


def test_stored_payment_events_keep_only_the_card_network(api, anon, plans, rzp):
    sub_id = checkout(api)
    send_webhook(anon, "subscription.charged", subscription=rzp.activate(sub_id), payment=payment_entity("pay_1"))
    assert WebhookEvent.objects.get().payload["payload"]["payment"]["entity"]["card"] == {"network": "Visa"}


@pytest.mark.parametrize("order", [("subscription.activated", "subscription.charged"), ("subscription.charged", "subscription.activated")])
def test_first_payment_sends_one_activation_email_and_renewals_send_their_own(
    api, anon, plans, rzp, monkeypatch, django_capture_on_commit_callbacks, order
):
    sent = []
    monkeypatch.setattr(webhooks, "notify", lambda sub, kind: sent.append(kind))
    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    with django_capture_on_commit_callbacks(execute=True):
        for event in order:
            send_webhook(anon, event, subscription=entity, payment=payment_entity("pay_1") if event.endswith("charged") else None)
    assert sent == ["activated"]

    sent.clear()
    with django_capture_on_commit_callbacks(execute=True):
        send_webhook(anon, "subscription.charged", subscription=rzp.activate(sub_id), payment=payment_entity("pay_2"),
                     created_at=int(time.time()) + 1)
    assert sent == ["renewed"]


# ---------------------------------------------------------------------------
# Second review
# ---------------------------------------------------------------------------

def test_checkout_links_expire_at_razorpay_after_a_day(api, plans, rzp):
    before = int(time.time())
    checkout(api)
    payload = rzp.calls[-1][2]
    assert before + DAY - 5 <= payload["expire_by"] <= int(time.time()) + DAY


def test_billing_actions_lock_their_own_row_not_the_users(api, user, plans, rzp):
    checkout(api)
    assert BillingLock.objects.filter(user=user).exists()


def test_a_stale_active_subscription_is_checked_with_razorpay_before_checkout(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    # The paid period and grace are over, and the cancellation webhook was missed.
    UserSubscription.objects.update(current_end=timezone.now() - timedelta(days=10))
    rzp.subscriptions[sub_id]["status"] = "cancelled"
    assert api.get("/api/subscriptions/current/").data["actions"]["subscribe"] is True

    checkout(api, "pro_plus_monthly")
    assert UserSubscription.objects.get(razorpay_subscription_id=sub_id).status == "cancelled"


def test_a_stale_active_subscription_that_renewed_still_blocks_checkout(api, anon, plans, rzp):
    sub_id = subscribe(api, anon, rzp)
    UserSubscription.objects.update(current_end=timezone.now() - timedelta(days=10))
    rzp.activate(sub_id)  # renewed; the webhook was missed
    res = api.post("/api/subscriptions/checkout/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "already_subscribed"
    assert tier(api) == "pro"


def test_cancelling_the_upcoming_subscription_sends_its_own_email(
    api, anon, plans, rzp, monkeypatch, django_capture_on_commit_callbacks
):
    sent = []
    monkeypatch.setattr(services, "notify", lambda sub, kind: sent.append(kind))
    monkeypatch.setattr(webhooks, "notify", lambda sub, kind: sent.append(kind))
    subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {}, format="json")
    new_id = checkout(api, "pro_yearly")
    send_webhook(anon, "subscription.authenticated", subscription={**rzp.subscriptions[new_id], "status": "authenticated"},
                 created_at=int(time.time()) + 1)
    sent.clear()
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"upcoming": True}, format="json")
        send_webhook(anon, "subscription.cancelled", subscription=dict(rzp.subscriptions[new_id]), created_at=int(time.time()) + 2)
    assert sent == ["upcoming_cancelled"]


def test_cancelling_now_sends_one_cancelled_email(api, anon, plans, rzp, monkeypatch, django_capture_on_commit_callbacks):
    sent = []
    monkeypatch.setattr(services, "notify", lambda sub, kind: sent.append(kind))
    monkeypatch.setattr(webhooks, "notify", lambda sub, kind: sent.append(kind))
    sub_id = subscribe(api, anon, rzp)
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
        send_webhook(anon, "subscription.cancelled", subscription=dict(rzp.subscriptions[sub_id]), created_at=int(time.time()) + 2)
    assert sent == ["cancelled"]


def _cancelled_email(mailoutbox):
    bodies = [m.body for m in mailoutbox if m.subject.endswith("plan has ended")]
    assert len(bodies) == 1
    return bodies[0]


def test_the_cancelled_email_says_the_account_is_back_on_free(
    api, anon, plans, rzp, settings, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    subscribe(api, anon, rzp)
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert _cancelled_email(mailoutbox).endswith("Your account is back on Free.")


def test_the_cancelled_email_names_the_complimentary_plan(
    api, anon, user, plans, rzp, settings, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    Profile.objects.filter(user=user).update(plan="pro")
    subscribe(api, anon, rzp, plan="pro_plus_monthly")
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert _cancelled_email(mailoutbox).endswith("Your account is on Pro.")


def test_the_cancelled_email_names_the_subscription_about_to_start(
    api, anon, plans, rzp, settings, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    sub_id = subscribe(api, anon, rzp)
    api.post("/api/subscriptions/cancel/", {}, format="json")
    new_id = checkout(api, "pro_plus_yearly")
    send_webhook(anon, "subscription.authenticated", subscription={**rzp.subscriptions[new_id], "status": "authenticated"},
                 created_at=int(time.time()) + 1)
    with django_capture_on_commit_callbacks(execute=True):
        send_webhook(anon, "subscription.cancelled", subscription={**rzp.subscriptions[sub_id], "status": "cancelled"},
                     created_at=int(time.time()) + 2)
    assert "Your Pro Plus subscription starts on " in _cancelled_email(mailoutbox)


def test_the_cancelled_email_ignores_an_authorised_checkout_with_no_start_date(
    api, anon, plans, rzp, settings, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    sub_id = subscribe(api, anon, rzp)
    other = UserSubscription.objects.get(razorpay_subscription_id=sub_id)
    other.pk, other.razorpay_subscription_id = None, "sub_other"
    other.status, other.start_at = SubscriptionStatus.AUTHENTICATED, None
    other.save()
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    body = _cancelled_email(mailoutbox)
    assert "soon" not in body and body.endswith("Your account is back on Free.")


def test_a_failure_writing_the_email_doesnt_fail_the_cancel(
    api, anon, plans, rzp, settings, monkeypatch, mailoutbox, django_capture_on_commit_callbacks
):
    settings.BILLING_EMAILS = True
    sub_id = subscribe(api, anon, rzp)

    def broken(sub):
        raise RuntimeError("database went away")

    monkeypatch.setattr(notifications, "_after_cancel", broken)
    with django_capture_on_commit_callbacks(execute=True):
        res = api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")
    assert res.status_code == 200
    assert UserSubscription.objects.get(razorpay_subscription_id=sub_id).status == "cancelled"
    assert not [m for m in mailoutbox if m.subject.endswith("plan has ended")]
