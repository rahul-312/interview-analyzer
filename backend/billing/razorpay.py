"""
The few Razorpay API calls billing needs, made server-side with the secret key, plus signature checks.

Only the parts of each response billing uses are relied on. Errors come back as RazorpayError with
Razorpay's description, which is safe to show (it never contains the key or card details).
"""
import hashlib
import hmac
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 20


class RazorpayError(Exception):
    def __init__(self, description, status=None, code=""):
        super().__init__(description)
        self.description = description
        self.status = status
        self.code = code


def enabled():
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def _request(method, path, payload=None):
    try:
        res = requests.request(
            method,
            f"{settings.RAZORPAY_API_URL}{path}",
            json=payload,
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Razorpay %s %s failed: %s", method, path, exc.__class__.__name__)
        raise RazorpayError("Couldn't reach the payment provider. Try again.") from exc
    try:
        body = res.json()
    except ValueError:
        body = {}
    if res.status_code >= 400:
        error = body.get("error") or {}
        logger.warning("Razorpay %s %s returned %s: %s", method, path, res.status_code, error.get("description"))
        raise RazorpayError(
            error.get("description") or "The payment provider rejected the request.",
            status=res.status_code,
            code=error.get("code", ""),
        )
    return body


def create_plan(*, interval, amount_paise, currency, name, description=""):
    """Creates a Razorpay plan billed every 1 month or year."""
    return _request("POST", "/plans", {
        "period": "monthly" if interval == "month" else "yearly",
        "interval": 1,
        "item": {"name": name, "amount": amount_paise, "currency": currency, "description": description},
    })


def create_subscription(*, plan_id, total_count, notes, start_at=None, expire_by=None):
    """`expire_by`: after this, Razorpay no longer accepts the first payment and expires the subscription."""
    payload = {"plan_id": plan_id, "total_count": total_count, "customer_notify": 1, "notes": notes}
    if start_at is not None:
        payload["start_at"] = int(start_at.timestamp())
    if expire_by is not None:
        payload["expire_by"] = int(expire_by.timestamp())
    return _request("POST", "/subscriptions", payload)


def fetch_subscription(subscription_id):
    return _request("GET", f"/subscriptions/{subscription_id}")


def update_subscription(subscription_id, *, plan_id, schedule_change_at):
    """Moves the subscription to another plan, "now" or at "cycle_end". Razorpay refuses this for UPI and eMandate."""
    return _request("PATCH", f"/subscriptions/{subscription_id}", {
        "plan_id": plan_id, "schedule_change_at": schedule_change_at, "customer_notify": 1,
    })


def cancel_subscription(subscription_id, *, at_cycle_end):
    return _request("POST", f"/subscriptions/{subscription_id}/cancel", {"cancel_at_cycle_end": 1 if at_cycle_end else 0})


def resume_subscription(subscription_id):
    """Resumes a paused subscription."""
    return _request("POST", f"/subscriptions/{subscription_id}/resume", {"resume_at": "now"})


def refund_payment(payment_id, *, notes):
    """Refunds the whole payment. Razorpay refuses a second full refund of the same payment."""
    return _request("POST", f"/payments/{payment_id}/refund", {"speed": "normal", "notes": notes})


def fetch_refunds(payment_id):
    """The payment's refunds, newest first, as Razorpay's collection: {"items": [...]}."""
    return _request("GET", f"/payments/{payment_id}/refunds")


def _hmac(secret, message):
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_checkout_signature(*, payment_id, subscription_id, signature):
    """
    Checks the signature Checkout returns for a subscription payment. `subscription_id` must be the
    one stored on the server, not the one the browser sent back.
    """
    if not (payment_id and subscription_id and signature and settings.RAZORPAY_KEY_SECRET):
        return False
    expected = _hmac(settings.RAZORPAY_KEY_SECRET, f"{payment_id}|{subscription_id}".encode())
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body, signature):
    """Checks X-Razorpay-Signature against the raw request body (bytes), before it's parsed."""
    if not (signature and settings.RAZORPAY_WEBHOOK_SECRET):
        return False
    return hmac.compare_digest(_hmac(settings.RAZORPAY_WEBHOOK_SECRET, body), signature)
