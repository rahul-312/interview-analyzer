import time
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from accounts.models import Profile
from billing import entitlements, razorpay
from billing.models import PaymentTransaction, SubscriptionPlan, SubscriptionStatus, UserSubscription, WebhookEvent

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
