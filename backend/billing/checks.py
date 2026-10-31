"""Deploy-time warnings for billing settings that would sell something the server can't deliver."""
from django.conf import settings
from django.core import checks

from . import entitlements, razorpay, tiers


@checks.register(checks.Tags.compatibility)
def paid_plans_have_ai(app_configs, **kwargs):
    if not settings.GEMINI_API_KEY and not settings.GEMINI_PAID_API_KEY and not settings.VERTEX_API_KEY:
        return []  # no AI anywhere: every plan says rule-based
    missing = [tiers.NAMES[code] for code in tiers.RANK if code != tiers.FREE and not entitlements.ai_ready(code)]
    if not missing:
        return []
    return [checks.Warning(
        f"{' and '.join(missing)} can't use Gemini: GEMINI_API_KEY is on the free tier and GEMINI_PAID_API_KEY isn't set.",
        hint=(
            "Paid plans never send debriefs to a free-tier key. Until a paid-tier key is set, they aren't sold"
            + (" (Razorpay is configured)" if razorpay.enabled() else "")
            + ", and users already on them, including complimentary ones, get the rule-based engine."
        ),
        id="billing.W001",
    )]


@checks.register(checks.Tags.security)
def signup_limit_is_shared(app_configs, **kwargs):
    # Debug is a single dev server, whose in-process count is enough
    if settings.DEBUG or not settings.VERTEX_API_KEY or settings.CACHE_URL:
        return []
    return [checks.Warning(
        "The sign-up rate limit counts per process: CACHE_URL isn't set.",
        hint=(
            "Every new account gets AI runs on the billed VERTEX_API_KEY. Without a shared cache, each worker "
            "keeps its own count and restarts reset it, so the real limit is a multiple of SIGNUP_THROTTLE_RATE."
        ),
        id="billing.W002",
    )]
