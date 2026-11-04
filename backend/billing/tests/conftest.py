import hashlib
import hmac
import itertools
import json
import time
import uuid
from unittest import mock

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from billing import razorpay
from billing.views import PLANS_CACHE_KEY
from billing.models import SubscriptionPlan

KEY_SECRET = "test_key_secret"
WEBHOOK_SECRET = "test_webhook_secret"
DAY = 86_400


@pytest.fixture(autouse=True)
def billing_settings(settings, monkeypatch):
    """Razorpay test keys, a paid-tier Gemini key (no real AI calls: tests that run jobs mock them) and no broker."""
    cache.delete(PLANS_CACHE_KEY)  # tests change what it returns
    settings.RAZORPAY_KEY_ID = "rzp_test_key"
    settings.RAZORPAY_KEY_SECRET = KEY_SECRET
    settings.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
    settings.GEMINI_API_KEY = ""
    settings.GEMINI_PAID_API_KEY = "paid-tier-key"  # paid plans are only sold with one
    settings.GEMINI_FREE_TIER = True
    settings.VERTEX_API_KEY = ""
    settings.BILLING_GRACE_DAYS = 3
    for code in ("PRO_MONTHLY", "PRO_YEARLY", "PRO_PLUS_MONTHLY", "PRO_PLUS_YEARLY"):
        monkeypatch.delenv(f"RAZORPAY_PLAN_{code}", raising=False)  # set in a developer's .env
    settings.CELERY_TASK_ALWAYS_EAGER = True
    # DRF reads the rates once at import, so patch them on the class
    monkeypatch.setattr(SimpleRateThrottle, "THROTTLE_RATES", {**SimpleRateThrottle.THROTTLE_RATES, "billing": "1000/min", "signup": "1000/min", "signup_attempt": "1000/min"})
    from config.celery import app
    app.conf.task_always_eager = True


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", email="alice@example.com", password="a-strong-pass-123")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="bob", password="a-strong-pass-123")


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def plans(db):
    """The four seeded plans, linked to (fake) Razorpay plans."""
    for plan in SubscriptionPlan.objects.all():
        plan.razorpay_plan_id = f"plan_{plan.code}"
        plan.save()
    return {p.code: p for p in SubscriptionPlan.objects.all()}


class FakeRazorpay:
    """Stands in for Razorpay's API: keeps subscriptions in memory and records every call."""

    def __init__(self):
        self.subscriptions = {}
        self.refunds = {}  # payment ID -> its refunds, oldest first
        # Payment ID -> amount paid, for payments that may be refunded in parts. Any other payment
        # can only be refunded once, in full.
        self.paid = {}
        self.calls = []
        self.fail_next = None  # a RazorpayError to raise on the next call
        self._ids = itertools.count(1)

    def __call__(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if self.fail_next:
            exc, self.fail_next = self.fail_next, None
            raise exc
        parts = path.strip("/").split("/")
        if parts == ["plans"]:
            return {"id": f"plan_new_{next(self._ids)}"}
        if parts[0] == "payments":
            refunds = self.refunds.setdefault(parts[1], [])
            if method == "GET":
                return {"entity": "collection", "count": len(refunds), "items": [dict(r) for r in reversed(refunds)]}
            if parts[1] in self.paid:
                if sum(r["amount"] for r in refunds) + payload["amount"] > self.paid[parts[1]]:
                    raise razorpay.RazorpayError("The refund amount is greater than the amount left to refund", status=400)
            elif refunds:
                raise razorpay.RazorpayError("The payment has been fully refunded already", status=400)
            refund = {
                "id": f"rfnd_{next(self._ids)}", "entity": "refund", "payment_id": parts[1], "status": "pending",
                "amount": payload.get("amount"), "notes": payload["notes"], "receipt": payload.get("receipt"),
                "created_at": int(time.time()),
            }
            refunds.append(refund)
            return dict(refund)
        if parts == ["subscriptions"] and method == "POST":
            sub_id = f"sub_{next(self._ids)}"
            self.subscriptions[sub_id] = {
                "id": sub_id, "entity": "subscription", "plan_id": payload["plan_id"], "status": "created",
                "short_url": f"https://rzp.io/i/{sub_id}", "start_at": payload.get("start_at"),
                "current_start": None, "current_end": None, "charge_at": None, "has_scheduled_changes": False,
            }
            return dict(self.subscriptions[sub_id])
        sub = self.subscriptions[parts[1]]
        if method == "GET":
            return dict(sub)
        if method == "PATCH":
            if payload["schedule_change_at"] == "now":
                sub["plan_id"] = payload["plan_id"]
            else:
                sub["has_scheduled_changes"] = True
                sub["change_scheduled_at"] = sub["current_end"]
            return dict(sub)
        if parts[2] == "cancel":
            if sub["status"] in ("cancelled", "completed", "expired"):
                raise razorpay.RazorpayError("Subscription is not cancellable in cancelled status", status=400)
            if not payload["cancel_at_cycle_end"]:
                sub["status"] = "cancelled"
                sub["ended_at"] = int(time.time())
            return dict(sub)
        if parts[2] == "resume":
            sub["status"] = "active"
            return dict(sub)
        raise AssertionError(f"unexpected call {method} {path}")

    def activate(self, sub_id, days=30, plan_id=None):
        """Razorpay's side of a successful first charge."""
        now = int(time.time())
        sub = self.subscriptions[sub_id]
        sub.update(
            status="active", current_start=now, current_end=now + days * DAY, charge_at=now + days * DAY,
            paid_count=sub.get("paid_count", 0) + 1,
        )
        if plan_id:
            sub["plan_id"] = plan_id
        return dict(sub)


@pytest.fixture
def rzp():
    fake = FakeRazorpay()
    with mock.patch.object(razorpay, "_request", fake):
        yield fake


def checkout_signature(payment_id, subscription_id):
    return hmac.new(KEY_SECRET.encode(), f"{payment_id}|{subscription_id}".encode(), hashlib.sha256).hexdigest()


def send_webhook(client, event, *, subscription=None, payment=None, refund=None, created_at=None, event_id=None,
                 secret=WEBHOOK_SECRET):
    payload = {}
    if refund is not None:
        payload["refund"] = {"entity": refund}
    if subscription is not None:
        payload["subscription"] = {"entity": subscription}
    if payment is not None:
        payload["payment"] = {"entity": payment}
    body = json.dumps({
        "entity": "event", "event": event, "payload": payload,
        "created_at": created_at if created_at is not None else int(time.time()),
    }).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return client.post(
        "/api/webhooks/razorpay/", data=body, content_type="application/json",
        HTTP_X_RAZORPAY_SIGNATURE=signature, HTTP_X_RAZORPAY_EVENT_ID=event_id or f"evt_{uuid.uuid4().hex[:14]}",
    )


def payment_entity(payment_id, *, status="captured", amount=19900, method="card", **extra):
    return {
        "id": payment_id, "entity": "payment", "amount": amount, "currency": "INR", "status": status,
        "method": method, "invoice_id": f"inv_{payment_id}", "email": "alice@example.com", "contact": "+919999999999",
        "card": {"network": "Visa", "last4": "1111"}, "created_at": int(time.time()), **extra,
    }
