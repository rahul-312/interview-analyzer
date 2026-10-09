"""
Analysis limits per plan.

Usage is counted over a rolling 24-hour window: each analysis frees up again
24 hours after it started. Only failures where nothing was billed are refunded
(see tasks.py and ai.NotCharged).
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Min
from django.utils import timezone

from accounts.models import Profile, get_profile

from .models import AnalysisRun, JobStatus, RoundAnalysis

WINDOW = timedelta(hours=24)
# A job queued or running for longer than this is treated as lost (worker or broker died).
STUCK_AFTER = timedelta(minutes=15)

QUEUED = "queued"
LIMITED = "limited"
BUSY = "busy"

IN_PROGRESS = (JobStatus.PENDING, JobStatus.RUNNING)


def plan_limit(plan):
    """Analyses allowed per 24 hours on this plan, or None for unlimited."""
    return settings.PLAN_ANALYSES_PER_24H.get(plan)


def _current_plan(user):
    # Read-only: profiles are created at sign-up, so a GET never needs to write one.
    profile = Profile.objects.filter(user=user).only("plan").first()
    return profile.plan if profile else Profile.Plan.FREE


def _window_stats(user, now):
    return AnalysisRun.objects.filter(user=user, created_at__gt=now - WINDOW).aggregate(
        used=Count("id"), oldest=Min("created_at")
    )


def analysis_usage(user):
    plan = _current_plan(user)
    limit = plan_limit(plan)
    stats = _window_stats(user, timezone.now())
    return {
        "plan": plan,
        "limit": limit,
        "used": stats["used"],
        "remaining": None if limit is None else max(0, limit - stats["used"]),
        # When the oldest run in the window expires, freeing one up.
        "next_available_at": (stats["oldest"] + WINDOW).isoformat() if stats["oldest"] and limit is not None else None,
    }


def limit_message(user):
    plan = _current_plan(user)
    return (
        f"You've used all {plan_limit(plan)} analyses allowed in 24 hours on the {Profile.Plan(plan).label} plan. "
        "Your debrief is saved; you can analyse it once one frees up."
    )


def reserve_analysis(user, rnd):
    """
    Starts an analysis for the round if allowed. Returns (QUEUED, run), (LIMITED, None) or (BUSY, None).

    Runs under a lock on the user's profile, so two requests at once can't both take the
    last analysis or start two analyses of the same round.
    """
    now = timezone.now()
    get_profile(user)  # make sure the row exists before locking it
    with transaction.atomic():
        profile = Profile.objects.select_for_update().get(user=user)
        analysis = RoundAnalysis.objects.filter(round=rnd).first()

        if analysis and analysis.status in IN_PROGRESS:
            if analysis.updated_at > now - STUCK_AFTER:
                return BUSY, None
            # Stuck job: give its run back and start again.
            if analysis.run_id:
                AnalysisRun.objects.filter(id=analysis.run_id).delete()

        limit = plan_limit(profile.plan)
        if limit is not None and _window_stats(user, now)["used"] >= limit:
            return LIMITED, None

        run = AnalysisRun.objects.create(user=user, round=rnd)
        RoundAnalysis.objects.update_or_create(
            round=rnd, defaults={"status": JobStatus.PENDING, "error": "", "stale": False, "run": run}
        )
        return QUEUED, run


def mark_stale(rnd):
    """The debrief changed but no new analysis could start: flag the old one as out of date."""
    RoundAnalysis.objects.filter(round=rnd).exclude(status__in=IN_PROGRESS).update(stale=True)
