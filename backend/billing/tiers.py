"""
What each plan includes. This is the one place plan features are defined: the entitlement
service, the usage limits and the plans API (and so the pricing page) all read from here.

Prices and Razorpay plan IDs are in the SubscriptionPlan table instead, since they differ between
test and live mode and are set up per deployment.
"""
from dataclasses import dataclass

from django.conf import settings

FREE = "free"
PRO = "pro"
PRO_PLUS = "pro_plus"

# Higher is better: a user on two plans at once (a complimentary one and a subscription) gets the higher.
RANK = {FREE: 0, PRO: 1, PRO_PLUS: 2}
NAMES = {FREE: "Free", PRO: "Pro", PRO_PLUS: "Pro Plus"}


@dataclass(frozen=True)
class Tier:
    code: str
    name: str
    # Jobs allowed per rolling 24 hours (None = unlimited).
    analyses_per_24h: int | None
    prep_plans_per_24h: int | None
    # Shown as "Unlimited, fair use", while analyses_per_24h is still enforced.
    analyses_fair_use: bool
    ai_model: str
    ai_model_label: str
    # Jobs go to the priority Celery queue.
    priority: bool
    # Product policy: whether this plan's debriefs may be used to train or improve the AI. Paid
    # plans' debriefs are never sent to a free-tier Gemini key, where Google may use them.
    debriefs_may_train: bool
    # The same on every plan, listed so the pricing page reads them from here too.
    rule_based_fallback: bool = True
    usage_tracking: bool = True
    browser_extension: bool = True

    @property
    def rank(self):
        return RANK[self.code]

    @property
    def paid(self):
        return self.code != FREE


def get_tier(code):
    """The tier for a plan code. Read from settings on every call, so limits can be changed per deployment."""
    if code not in RANK:
        code = FREE
    better_model = settings.GEMINI_PRO_MODEL or settings.GEMINI_MODEL
    return Tier(
        code=code,
        name=NAMES[code],
        analyses_per_24h=settings.PLAN_ANALYSES_PER_24H.get(code),
        prep_plans_per_24h=settings.PLAN_PREP_PLANS_PER_24H.get(code),
        analyses_fair_use=code == PRO_PLUS,
        ai_model=better_model if code == PRO_PLUS else settings.GEMINI_MODEL,
        ai_model_label="Better model (Pro-class)" if code == PRO_PLUS else "Flash",
        priority=code == PRO_PLUS,
        debriefs_may_train=code == FREE,
    )


def all_tiers():
    return [get_tier(code) for code in sorted(RANK, key=RANK.get)]
