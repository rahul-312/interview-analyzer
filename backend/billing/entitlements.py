"""
Which plan a user is on and what it gives them, from trusted server-side state only: Razorpay
subscriptions (written from webhooks and server-side API calls) and the complimentary plan an
admin can set on the profile. Everything that depends on the plan (usage limits, the AI model,
the queue, where debriefs may go) asks here, for the web app and the browser extension alike.

Access policy:
- active: paid access, until the end of the paid period (plus the grace period, in case the
  renewal webhook is late; none when cancellation was asked for at period end).
- pending (a renewal charge failed and Razorpay is retrying): access for BILLING_GRACE_DAYS
  after the paid period ends.
- created, authenticated (mandate set up but nothing charged yet), halted, paused, cancelled,
  completed, expired: no paid access.
"""
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from accounts.models import Profile

from . import tiers
from .models import SubscriptionStatus, UserSubscription

ACCESS_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING)


def grace():
    return timedelta(days=settings.BILLING_GRACE_DAYS)


def access_until(sub):
    """When this subscription's paid access ends, or None if it gives none (or has no known end)."""
    if sub.status not in ACCESS_STATUSES or sub.current_end is None:
        return None
    if sub.cancel_at_period_end:
        return sub.current_end
    return sub.current_end + grace()


def gives_access(sub, now=None):
    now = now or timezone.now()
    if sub.status == SubscriptionStatus.ACTIVE and sub.current_end is None:
        return True  # just activated; Razorpay sends the period with the first charge
    end = access_until(sub)
    return end is not None and now < end


def entitled_subscription(user, now=None):
    """The user's subscription that gives the best access right now, or None."""
    now = now or timezone.now()
    subs = [
        s for s in UserSubscription.objects.filter(user=user, status__in=ACCESS_STATUSES).select_related("plan")
        if gives_access(s, now)
    ]
    # Best tier first; then active over pending (still retrying a charge); then the newest.
    subs.sort(key=lambda s: (tiers.RANK[s.tier], s.status == SubscriptionStatus.ACTIVE, s.created_at), reverse=True)
    return subs[0] if subs else None


def _complimentary_plan(user):
    # Read-only: profiles are created at sign-up, so a GET never needs to write one.
    profile = Profile.objects.filter(user=user).only("plan").first()
    return profile.plan if profile else tiers.FREE


def tier_for(user, now=None):
    """The user's effective plan code: the higher of their complimentary plan and their subscription."""
    comp = _complimentary_plan(user)
    sub = entitled_subscription(user, now)
    paid = sub.tier if sub else tiers.FREE
    return max(comp, paid, key=lambda code: tiers.RANK.get(code, 0))


def for_user(user, now=None):
    """The user's tier (billing.tiers.Tier): their limits, model, queue and data rules."""
    return tiers.get_tier(tier_for(user, now))


@dataclass(frozen=True)
class AiRoute:
    """Where a job's text goes: which Gemini key and model."""
    api_key: str
    model: str
    # The key is on Gemini's free tier, where Google may use prompts to improve its products.
    provider_may_train: bool


def ai_route(tier):
    """
    The Gemini key and model for jobs on this tier, or None for the rule-based engine.
    Plans whose debriefs mustn't be used for training never get a free-tier key: with no paid-tier
    key configured they use the rule-based engine instead.
    """
    free_tier_key = settings.GEMINI_API_KEY if settings.GEMINI_FREE_TIER else ""
    paid_keys = [k for k in (settings.GEMINI_PAID_API_KEY, "" if settings.GEMINI_FREE_TIER else settings.GEMINI_API_KEY) if k]
    if tier.debriefs_may_train:
        key = free_tier_key or (paid_keys[0] if paid_keys else "")
    else:
        key = paid_keys[0] if paid_keys else ""
    if not key:
        return None
    return AiRoute(api_key=key, model=tier.ai_model, provider_may_train=bool(free_tier_key) and key == free_tier_key)
