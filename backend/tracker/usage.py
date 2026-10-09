"""
Daily analysis limits per plan.

Usage is counted over a rolling 24-hour window: each analysis frees up again
24 hours after it started. Failed analyses are refunded (see tasks.py).
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from accounts.models import Profile, get_profile

from .models import AnalysisRun

WINDOW = timedelta(hours=24)


def analysis_limit(user):
    """Analyses allowed per 24 hours, or None for unlimited."""
    return settings.PLAN_DAILY_ANALYSES.get(get_profile(user).plan)


def _runs_in_window(user, now):
    return AnalysisRun.objects.filter(user=user, created_at__gt=now - WINDOW)


def analysis_usage(user):
    now = timezone.now()
    limit = analysis_limit(user)
    runs = _runs_in_window(user, now)
    used = runs.count()
    oldest = runs.order_by("created_at").first()
    return {
        "plan": get_profile(user).plan,
        "limit": limit,
        "used": used,
        "remaining": None if limit is None else max(0, limit - used),
        # When the next analysis frees up (only meaningful once some are used).
        "next_available_at": (oldest.created_at + WINDOW).isoformat() if oldest and limit is not None else None,
    }


def start_analysis(user, rnd):
    """Records an analysis run if the user has one left. Returns the run, or None at the limit."""
    with transaction.atomic():
        # Lock the profile row so two requests at once can't both take the last analysis.
        get_profile(user)
        profile = Profile.objects.select_for_update().get(user=user)
        limit = settings.PLAN_DAILY_ANALYSES.get(profile.plan)
        if limit is not None and _runs_in_window(user, timezone.now()).count() >= limit:
            return None
        return AnalysisRun.objects.create(user=user, round=rnd)


def limit_message(user):
    usage = analysis_usage(user)
    return (
        f"You've used all {usage['limit']} analyses for today on the free plan. "
        "Your debrief is saved; you can analyse it once one frees up."
    )
