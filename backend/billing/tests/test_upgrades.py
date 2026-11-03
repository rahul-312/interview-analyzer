"""
Upgrading a UPI Autopay or eMandate subscription, which Razorpay can't move to another plan: a new
subscription is bought, and once it's paid the old one is cancelled and its unused days refunded.
"""
import time
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from billing import razorpay, services
from billing.models import PaymentTransaction, UserSubscription

from .conftest import DAY, payment_entity, send_webhook
from .test_subscriptions import checkout, refund_calls, tier

pytestmark = pytest.mark.django_db

PRO = 19900


def subscribe_upi(api, anon, rzp, plan="pro_monthly", *, days_ago=10, period_days=30, amount=PRO, payment_id="pay_pro"):
    """A subscription paid by UPI Autopay `days_ago` days into a `period_days`-day period. Returns it."""
    sub_id = checkout(api, plan)
    entity = rzp.activate(sub_id, days=period_days)
    shift = int(days_ago * DAY)
    entity.update(current_start=entity["current_start"] - shift, current_end=entity["current_end"] - shift)
    entity["charge_at"] = entity["current_end"]
    rzp.subscriptions[sub_id].update(entity)
    send_webhook(anon, "subscription.charged", subscription=entity,
                 payment=payment_entity(payment_id, method="upi", amount=amount))
    PaymentTransaction.objects.filter(razorpay_payment_id=payment_id).update(paid_at=timezone.now() - timedelta(seconds=shift))
    rzp.paid[payment_id] = amount
    return UserSubscription.objects.get(razorpay_subscription_id=sub_id)


def upgrade(api, plan="pro_plus_monthly"):
    res = api.post("/api/subscriptions/change-plan/", {"plan": plan}, format="json")
    assert res.status_code == 200, res.data
    assert res.data["change"] == "checkout"
    return res.data["checkout"]["subscription_id"]


def pay(anon, rzp, sub_id, capture, *, payment_id="pay_plus", amount=49900):
    """Razorpay's side of paying the upgrade's checkout, with the task it queues run."""
    entity = rzp.activate(sub_id)
    with capture(execute=True):
        res = send_webhook(anon, "subscription.activated", subscription=entity)
    assert res.status_code == 200, res.data
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity(payment_id, method="upi", amount=amount))
    return UserSubscription.objects.get(razorpay_subscription_id=sub_id)


def cancel_calls(rzp, sub_id):
    return [c for c in rzp.calls if c[:2] == ("POST", f"/subscriptions/{sub_id}/cancel")]


def quote(api, plan="pro_plus_monthly"):
    return api.get("/api/subscriptions/upgrade-quote/", {"plan": plan})


def expected_credit(old, new):
    """The unused part of the old plan's payment, from when the new plan started."""
    length = int((old.current_end - old.current_start).total_seconds())
    left = int((old.current_end - new.credit_from).total_seconds())
    return PRO * left // length


# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

def test_the_quote_shows_the_charge_and_about_what_comes_back(api, anon, plans, rzp):
    subscribe_upi(api, anon, rzp, days_ago=10)
    res = quote(api)
    assert res.status_code == 200
    data = res.data
    assert (data["strategy"], data["available"], data["charge_paise"], data["credit_reason"]) == (
        "replacement", True, 49900, "",
    )
    assert abs(data["credit_paise"] - PRO * 20 // 30) <= 1  # 20 of 30 days left


def test_card_subscriptions_are_still_moved_to_the_new_plan(api, anon, plans, rzp):
    sub_id = checkout(api)
    entity = rzp.activate(sub_id)
    send_webhook(anon, "subscription.charged", subscription=entity, payment=payment_entity("pay_1"))
    assert quote(api).data["strategy"] == "native_change"
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.data["change"] == "now" and "checkout" not in res.data


def test_the_quote_is_only_for_upgrades(api, anon, plans, rzp):
    subscribe_upi(api, anon, rzp, "pro_plus_monthly", amount=49900)
    res = quote(api, "pro_monthly")
    assert res.status_code == 400 and res.data["code"] == "not_an_upgrade"


def test_a_credit_under_a_rupee_isnt_refunded_and_the_quote_says_so(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    subscribe_upi(api, anon, rzp, days_ago=29.9)  # 0.1 day left: 66 paise
    data = quote(api).data
    assert (data["available"], data["credit_paise"], data["credit_reason"]) == (True, 0, "below_minimum")
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    assert new.replacement_status == "done" and new.credit_reason == "below_minimum"
    assert refund_calls(rzp) == []


def test_a_payment_too_old_to_refund_isnt_upgraded_before_anything_is_charged(api, anon, plans, rzp):
    subscribe_upi(api, anon, rzp, "pro_yearly", days_ago=200, period_days=365, amount=169900)
    data = quote(api).data
    assert (data["available"], data["credit_reason"]) == (False, "too_old")
    res = api.post("/api/subscriptions/change-plan/", {"plan": "pro_plus_monthly"}, format="json")
    assert res.status_code == 409 and res.data["code"] == "upgrade_at_renewal"
    assert UserSubscription.objects.count() == 1


def test_yearly_pro_to_monthly_pro_plus_credits_the_rest_of_the_year(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, "pro_yearly", days_ago=65, period_days=365, amount=169900)
    assert abs(quote(api).data["credit_paise"] - 169900 * 300 // 365) <= 1
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    old.refresh_from_db()
    length = int((old.current_end - old.current_start).total_seconds())
    assert new.credit_paise == 169900 * int((old.current_end - new.credit_from).total_seconds()) // length
    [(_, _, payload)] = refund_calls(rzp)
    assert payload["amount"] == new.credit_paise


# ---------------------------------------------------------------------------
# Checkout, then finishing
# ---------------------------------------------------------------------------

def test_the_upgrade_checkout_leaves_the_current_plan_alone(api, anon, plans, rzp):
    old = subscribe_upi(api, anon, rzp)
    new_id = upgrade(api)
    _, path, payload = rzp.calls[-1]
    assert path == "/subscriptions" and payload["plan_id"] == "plan_pro_plus_monthly"
    assert "start_at" not in payload  # starts now
    assert payload["notes"]["replaces"] == old.razorpay_subscription_id
    new = UserSubscription.objects.get(razorpay_subscription_id=new_id)
    assert (new.replaces, new.replacement_status, new.status) == (old, "awaiting_payment", "created")
    assert cancel_calls(rzp, old.razorpay_subscription_id) == [] and refund_calls(rzp) == []
    assert tier(api) == "pro"
    # A repeated click reuses the checkout.
    assert upgrade(api) == new_id


def test_paying_finishes_the_upgrade(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, days_ago=10)
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    old.refresh_from_db()
    assert tier(api) == "pro_plus"
    assert (new.replacement_status, new.credit_reason, new.credit_payment.razorpay_payment_id) == ("done", "", "pay_pro")
    assert new.credit_paise == expected_credit(old, new) and abs(new.credit_paise - PRO * 20 // 30) <= 1
    # Cancelled now, then refunded: the unused part, recognisable by its receipt.
    assert cancel_calls(rzp, old.razorpay_subscription_id) == [
        ("POST", f"/subscriptions/{old.razorpay_subscription_id}/cancel", {"cancel_at_cycle_end": 0}),
    ]
    assert old.status == "cancelled"
    payment = PaymentTransaction.objects.get(razorpay_payment_id="pay_pro")
    [(_, path, payload)] = refund_calls(rzp)
    assert path == "/payments/pay_pro/refund" and payload["amount"] == new.credit_paise
    assert payload["receipt"] == f"upgrade_credit:{payment.pk}" and payload["notes"]["reason"] == "upgrade_credit"
    assert (payment.refund_status, payment.refund_reason, payment.status) == ("pending", "upgrade_credit", "captured")
    shown = next(p for p in api.get("/api/subscriptions/payments/").data if p["razorpay_payment_id"] == "pay_pro")
    assert (shown["refund_paise"], shown["refund_reason"]) == (new.credit_paise, "upgrade_credit")

    # Processed: a partial refund leaves the payment captured.
    refund = rzp.refunds["pay_pro"][0]
    send_webhook(anon, "refund.processed", refund={**refund, "status": "processed"},
                 payment=payment_entity("pay_pro", method="upi", status="captured"))
    payment.refresh_from_db()
    assert (payment.refund_status, payment.status) == ("processed", "captured")


def test_an_upgrade_credit_doesnt_use_up_the_money_back_window(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    subscribe_upi(api, anon, rzp, days_ago=10)
    pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    assert api.get("/api/subscriptions/current/").data["refund"]["amount_paise"] == 49900


def test_inside_the_money_back_window_only_one_plan_is_refunded_in_full(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, days_ago=2)
    # Still pro-rata: a full refund here, plus the new plan's own window, would refund both plans.
    assert abs(quote(api).data["credit_paise"] - PRO * 28 // 30) <= 1
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    assert new.credit_paise == expected_credit(old, new) < PRO
    # Cancelling the new plan inside its window refunds it, and only it, in full.
    res = api.post("/api/subscriptions/cancel/", {"at_period_end": False, "expect_refund": True}, format="json")
    assert res.status_code == 200 and res.data["refunded"]["amount_paise"] == 49900
    assert sorted((path, payload["amount"]) for _, path, payload in refund_calls(rzp)) == [
        ("/payments/pay_plus/refund", 49900), ("/payments/pay_pro/refund", new.credit_paise),
    ]


def test_a_repeated_activation_doesnt_cancel_or_refund_twice(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp)
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        send_webhook(anon, "subscription.activated", subscription=rzp.subscriptions[new.razorpay_subscription_id],
                     created_at=int(time.time()) + 5)
    services.finish_replacement(new.pk)
    call_command("reconcile_subscriptions")
    assert len(cancel_calls(rzp, old.razorpay_subscription_id)) == 1
    assert len(refund_calls(rzp)) == 1


def test_a_second_upgrade_is_refused_while_one_is_finishing(api, anon, plans, rzp, monkeypatch, django_capture_on_commit_callbacks):
    subscribe_upi(api, anon, rzp, "pro_monthly")
    monkeypatch.setattr(razorpay, "cancel_subscription", unreachable)
    new = pay(anon, rzp, upgrade(api, "pro_plus_monthly"), django_capture_on_commit_callbacks)
    assert new.replacement_status == "finishing"
    # The current plan is now Pro Plus monthly; yearly is a switch, not an upgrade, so try it directly.
    with pytest.raises(services.BillingError) as err:
        services.start_replacement(new.user, new, new.plan)
    assert err.value.code == "upgrade_in_progress"


# ---------------------------------------------------------------------------
# Abandoned checkouts
# ---------------------------------------------------------------------------

def test_an_abandoned_upgrade_checkout_leaves_the_plan_and_doesnt_block_another(api, anon, plans, rzp):
    old = subscribe_upi(api, anon, rzp)
    first = upgrade(api)
    UserSubscription.objects.filter(razorpay_subscription_id=first).update(created_at=timezone.now() - timedelta(days=2))
    call_command("reconcile_subscriptions")
    abandoned = UserSubscription.objects.get(razorpay_subscription_id=first)
    assert (abandoned.status, abandoned.replacement_status) == ("expired", "abandoned")
    old.refresh_from_db()
    assert old.status == "active" and tier(api) == "pro"
    assert upgrade(api) != first


def test_an_expired_checkout_still_marked_awaiting_payment_doesnt_block_another(api, anon, plans, rzp):
    subscribe_upi(api, anon, rzp)
    first = upgrade(api)
    UserSubscription.objects.filter(razorpay_subscription_id=first).update(
        status="expired", created_at=timezone.now() - timedelta(days=2),
    )
    assert UserSubscription.objects.get(razorpay_subscription_id=first).replacement_status == "awaiting_payment"
    assert upgrade(api) != first


def test_a_checkout_given_up_on_but_paid_after_all_still_finishes(api, anon, plans, rzp, django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp)
    new_id = upgrade(api)
    UserSubscription.objects.filter(razorpay_subscription_id=new_id).update(status="expired", replacement_status="abandoned")
    new = pay(anon, rzp, new_id, django_capture_on_commit_callbacks)
    old.refresh_from_db()
    assert (new.status, new.replacement_status, old.status) == ("active", "done", "cancelled")


# ---------------------------------------------------------------------------
# When things go wrong
# ---------------------------------------------------------------------------

def unreachable(*args, **kwargs):
    raise razorpay.RazorpayError("Couldn't reach the payment provider. Try again.")


def test_razorpay_unreachable_when_cancelling_the_old_plan_is_retried(api, anon, plans, rzp, monkeypatch,
                                                                      django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp)
    with monkeypatch.context() as m:
        m.setattr(razorpay, "cancel_subscription", unreachable)
        new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    # Pro Plus stands; nothing is refunded while the old plan could still renew.
    assert tier(api) == "pro_plus"
    assert new.replacement_status == "finishing" and new.credit_paise == expected_credit(old, new)
    assert refund_calls(rzp) == []
    call_command("reconcile_subscriptions")
    new.refresh_from_db()
    old.refresh_from_db()
    assert (new.replacement_status, old.status) == ("done", "cancelled")
    [(_, _, payload)] = refund_calls(rzp)
    assert payload["amount"] == new.credit_paise


def test_an_old_plan_razorpay_wont_cancel_isnt_refunded(api, anon, plans, rzp, monkeypatch, django_capture_on_commit_callbacks):
    def refused(*args, **kwargs):
        raise razorpay.RazorpayError("Subscription cannot be cancelled", status=400)

    old = subscribe_upi(api, anon, rzp)
    monkeypatch.setattr(razorpay, "cancel_subscription", refused)
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    assert new.replacement_status == "needs_attention" and "wouldn't cancel" in new.replacement_error
    assert refund_calls(rzp) == []
    old.refresh_from_db()
    assert old.status == "active"


def test_an_old_plan_set_to_end_at_period_end_is_still_credited(api, anon, plans, rzp, monkeypatch,
                                                                django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp)
    new_id = upgrade(api)
    api.post("/api/subscriptions/cancel/", {}, format="json")  # at period end, while the upgrade is being paid

    def refused(*args, **kwargs):
        raise razorpay.RazorpayError("Subscription is already scheduled to be cancelled", status=400)

    monkeypatch.setattr(razorpay, "cancel_subscription", refused)
    new = pay(anon, rzp, new_id, django_capture_on_commit_callbacks)
    # It can't renew, so it's credited even though Razorpay won't end it early.
    assert new.replacement_status == "done" and new.credit_paise == expected_credit(old, new)
    assert len(refund_calls(rzp)) == 1


def test_an_old_plan_cancelled_before_the_upgrade_was_paid_gets_no_credit(api, anon, plans, rzp,
                                                                          django_capture_on_commit_callbacks):
    subscribe_upi(api, anon, rzp, days_ago=10)
    new_id = upgrade(api)
    api.post("/api/subscriptions/cancel/", {"at_period_end": False}, format="json")  # outside the window: no refund
    new = pay(anon, rzp, new_id, django_capture_on_commit_callbacks)
    assert (new.replacement_status, new.credit_paise, new.credit_reason) == ("done", 0, "already_ended")
    assert refund_calls(rzp) == []


def test_a_renewal_after_the_credit_was_decided_is_refunded_in_full(api, anon, plans, rzp, monkeypatch,
                                                                    django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, days_ago=29.5)
    with monkeypatch.context() as m:
        m.setattr(razorpay, "cancel_subscription", unreachable)
        new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    credit = new.credit_paise
    assert new.replacement_status == "finishing" and credit == expected_credit(old, new)

    # Before the cancel gets through, the old plan renews.
    entity = rzp.subscriptions[old.razorpay_subscription_id]
    entity.update(current_start=entity["current_end"], current_end=entity["current_end"] + 30 * DAY)
    send_webhook(anon, "subscription.charged", subscription=entity, created_at=int(time.time()) + 3600,
                 payment=payment_entity("pay_renewal", method="upi"))
    call_command("reconcile_subscriptions")
    new.refresh_from_db()
    assert (new.replacement_status, new.credit_paise) == ("done", credit)  # decided once
    assert sorted((path, payload["amount"]) for _, path, payload in refund_calls(rzp)) == [
        ("/payments/pay_pro/refund", credit), ("/payments/pay_renewal/refund", PRO),
    ]


def test_a_renewal_recorded_before_the_upgrade_doesnt_refund_the_period_used(api, anon, plans, rzp,
                                                                           django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, days_ago=29.5)  # half a day left
    new_id = upgrade(api)
    renewal_at = rzp.subscriptions[old.razorpay_subscription_id]["current_end"]
    new_entity = rzp.activate(new_id)  # paid now...

    # ...but the old plan's renewal, half a day later, is recorded first (the activation webhook was missed).
    entity = rzp.subscriptions[old.razorpay_subscription_id]
    entity.update(current_start=renewal_at, current_end=renewal_at + 30 * DAY)
    send_webhook(anon, "subscription.charged", subscription=entity, created_at=renewal_at,
                 payment=payment_entity("pay_renewal", method="upi"))
    with django_capture_on_commit_callbacks(execute=True):
        send_webhook(anon, "subscription.activated", subscription=new_entity)
    new = UserSubscription.objects.get(razorpay_subscription_id=new_id)

    # The credit is the half day of the period the upgrade fell in, not the whole payment.
    paid_at = PaymentTransaction.objects.get(razorpay_payment_id="pay_pro").paid_at
    period = renewal_at - int(paid_at.timestamp())
    assert new.replacement_status == "done"
    assert new.credit_paise == PRO * (renewal_at - int(new.credit_from.timestamp())) // period
    assert new.credit_paise < PRO // 30
    assert sorted((path, payload["amount"]) for _, path, payload in refund_calls(rzp)) == [
        ("/payments/pay_pro/refund", new.credit_paise), ("/payments/pay_renewal/refund", PRO),
    ]


def test_a_credit_whose_period_was_never_seen_is_left_for_someone(api, anon, plans, rzp,
                                                                 django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp, days_ago=10)
    new_id = upgrade(api)
    # Two renewals were missed here: the period recorded ended before the upgrade, and Razorpay's
    # current one starts after it. The one the upgrade fell in was never seen.
    now = int(time.time())
    UserSubscription.objects.filter(pk=old.pk).update(
        current_start=timezone.now() - timedelta(days=40), current_end=timezone.now() - timedelta(days=10),
    )
    rzp.subscriptions[old.razorpay_subscription_id].update(current_start=now + 3600, current_end=now + 3600 + 30 * DAY)
    new = pay(anon, rzp, new_id, django_capture_on_commit_callbacks)

    assert (new.replacement_status, new.credit_paise, new.credit_reason) == ("needs_attention", 0, "no_period")
    assert "pay_pro" in new.replacement_error and "credit it by hand" in new.replacement_error
    old.refresh_from_db()
    assert old.status == "cancelled"  # it still can't charge again
    assert refund_calls(rzp) == []


def test_a_paid_abandoned_checkout_that_clashes_with_another_upgrade_is_flagged(api, anon, plans, rzp,
                                                                                django_capture_on_commit_callbacks):
    old = subscribe_upi(api, anon, rzp)
    first = upgrade(api)
    UserSubscription.objects.filter(razorpay_subscription_id=first).update(
        status="expired", replacement_status="abandoned", created_at=timezone.now() - timedelta(days=2),
    )
    second = upgrade(api)
    assert second != first
    # Razorpay says the abandoned one was paid after all.
    entity = rzp.activate(first)
    with django_capture_on_commit_callbacks(execute=True):
        res = send_webhook(anon, "subscription.activated", subscription=entity)
    assert res.status_code == 200
    paid = UserSubscription.objects.get(razorpay_subscription_id=first)
    assert (paid.status, paid.replacement_status) == ("active", "needs_attention")
    assert second in paid.replacement_error
    old.refresh_from_db()
    assert old.status == "active" and refund_calls(rzp) == []


def test_the_quote_is_unavailable_without_razorpay_keys(api, anon, plans, rzp, settings):
    subscribe_upi(api, anon, rzp)
    settings.RAZORPAY_KEY_ID = ""
    assert quote(api).status_code == 503


def test_a_partial_refund_razorpay_made_without_answering_isnt_made_twice(api, anon, plans, rzp, monkeypatch,
                                                                          django_capture_on_commit_callbacks):
    real_refund = razorpay.refund_payment

    def made_then_timed_out(payment_id, **kwargs):
        real_refund(payment_id, **kwargs)
        raise razorpay.RazorpayError("Couldn't reach the payment provider. Try again.")

    subscribe_upi(api, anon, rzp)
    with monkeypatch.context() as m:
        m.setattr(razorpay, "refund_payment", made_then_timed_out)
        pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    payment = PaymentTransaction.objects.get(razorpay_payment_id="pay_pro")
    assert payment.refund_status == "sending"  # it may have been made: the claim is kept

    call_command("reconcile_subscriptions")
    assert len(refund_calls(rzp)) == 1  # the claim is still fresh
    PaymentTransaction.objects.filter(pk=payment.pk).update(refund_claimed_at=timezone.now() - timedelta(minutes=11))
    call_command("reconcile_subscriptions")
    payment.refresh_from_db()
    assert len(rzp.refunds["pay_pro"]) == 1 and len(refund_calls(rzp)) == 1
    assert (payment.refund_status, payment.razorpay_refund_id) == ("pending", rzp.refunds["pay_pro"][0]["id"])


def test_a_refund_claimed_by_another_attempt_is_left_to_it(api, anon, plans, rzp):
    subscribe_upi(api, anon, rzp)
    PaymentTransaction.objects.update(refund_status="sending", refund_claim="other", refund_claimed_at=timezone.now(),
                                      refund_amount_paise=5000, refund_op_id="upgrade_credit:1")
    services.settle_refund(PaymentTransaction.objects.get())
    assert refund_calls(rzp) == [] and not any(c[1].endswith("/refunds") for c in rzp.calls)


# ---------------------------------------------------------------------------
# Emails
# ---------------------------------------------------------------------------

def test_one_email_says_the_upgrade_is_done_and_what_comes_back(api, anon, plans, rzp, settings, mailoutbox,
                                                                django_capture_on_commit_callbacks):
    settings.BILLING_EMAILS = True
    old = subscribe_upi(api, anon, rzp)
    mailoutbox.clear()
    new = pay(anon, rzp, upgrade(api), django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        send_webhook(anon, "subscription.cancelled", subscription=rzp.subscriptions[old.razorpay_subscription_id],
                     created_at=int(time.time()) + 5)
    [mail] = mailoutbox
    assert mail.subject == "You're now on Pro Plus"
    rupees = f"₹{new.credit_paise / 100:,.2f}".removesuffix(".00")
    assert f"We're refunding {rupees} for the unused days of your previous plan" in mail.body
