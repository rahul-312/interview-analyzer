"""
Limits on paid AI jobs, per plan: round analyses and prep plans.

Usage is counted over a rolling 24-hour window: each job frees up again 24 hours
after it started. Failures that weren't the user's fault are refunded (see refund_run
and tasks.py); refunds of failures that already cost an API call are capped.
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Min
from django.utils import timezone

from accounts.models import Profile, get_profile

from . import ai
from .models import AnalysisRun, JobStatus, PrepPlan, RoundAnalysis

WINDOW = timedelta(hours=24)
# A job still queued, or running, this long after it was queued or started is treated as lost.
STUCK_AFTER = timedelta(minutes=15)

QUEUED = "queued"
LIMITED = "limited"
BUSY = "busy"

IN_PROGRESS = (JobStatus.PENDING, JobStatus.RUNNING)

ANALYSIS = AnalysisRun.Kind.ANALYSIS
PREP_PLAN = AnalysisRun.Kind.PREP_PLAN

# How each kind is named in messages, and what "at the limit" means for the user.
_WORDING = {
    ANALYSIS: ("analyses", "Your debrief is saved; you can analyse it once one frees up."),
    PREP_PLAN: ("prep plans", "You can make or regenerate a plan once one frees up."),
}


def plan_limit(plan, kind=ANALYSIS):
    """
    Jobs of this kind allowed per 24 hours on this plan, or None for unlimited.
    The limits are cost control, so with no API key (free rule-based jobs) nothing is limited.
    """
    if not ai.ai_enabled():
        return None
    limits = settings.PLAN_ANALYSES_PER_24H if kind == ANALYSIS else settings.PLAN_PREP_PLANS_PER_24H
    return limits.get(plan)


def _current_plan(user):
    # Read-only: profiles are created at sign-up, so a GET never needs to write one.
    profile = Profile.objects.filter(user=user).only("plan").first()
    return profile.plan if profile else Profile.Plan.FREE


def _window_stats(user, kind, now):
    return AnalysisRun.objects.filter(
        user=user, kind=kind, refunded=False, free=False, created_at__gt=now - WINDOW
    ).aggregate(used=Count("id"), oldest=Min("created_at"))


def _quota(user, plan, kind, now):
    limit = plan_limit(plan, kind)
    stats = _window_stats(user, kind, now)
    return {
        "limit": limit,
        "used": stats["used"],
        "remaining": None if limit is None else max(0, limit - stats["used"]),
        # When the oldest run in the window expires, freeing one up.
        "next_available_at": (stats["oldest"] + WINDOW).isoformat() if stats["oldest"] and limit is not None else None,
    }


def usage(user):
    """The user's plan and what they have left of each limited job."""
    plan = _current_plan(user)
    now = timezone.now()
    return {
        "plan": plan,
        # False with no API key: jobs use the free rule-based engine, so the limits are off.
        "ai_enabled": ai.ai_enabled(),
        "analyses": _quota(user, plan, ANALYSIS, now),
        "prep_plans": _quota(user, plan, PREP_PLAN, now),
    }


def limit_message(user, kind=ANALYSIS):
    plan = _current_plan(user)
    noun, next_step = _WORDING[kind]
    return (
        f"You've used all {plan_limit(plan, kind)} {noun} allowed in 24 hours on the "
        f"{Profile.Plan(plan).label} plan. {next_step}"
    )


def refund_run(run_id, *, billed):
    """
    Gives a run back so it no longer counts. Free refunds (nothing reached the paid API) always
    succeed; billed ones are capped per user per 24 hours, across both kinds of job.
    Returns True if the run was refunded.
    """
    user_id = AnalysisRun.objects.filter(id=run_id).values_list("user_id", flat=True).first()
    if user_id is None:
        return False
    with transaction.atomic():
        # Same lock as _reserve: two failures finishing together can't both pass the cap.
        Profile.objects.select_for_update().filter(user_id=user_id).first()
        run = AnalysisRun.objects.select_for_update().filter(id=run_id, refunded=False).first()
        if run is None:
            return False
        if billed:
            recent = AnalysisRun.objects.filter(
                user_id=run.user_id, refunded=True, billed=True, created_at__gt=timezone.now() - WINDOW
            ).count()
            if recent >= settings.BILLED_REFUNDS_PER_24H:
                return False
        run.refunded = True
        run.billed = billed
        run.save(update_fields=["refunded", "billed"])
        return True


def _check_existing_job(job, now):
    """
    `job` is the locked RoundAnalysis or PrepPlan row (or None). Returns BUSY if it already has a
    live job; otherwise releases a stuck one so a new job can start, and returns None.
    """
    if job is None or job.status not in IN_PROGRESS or job.run_id is None:
        return None  # nothing running (or an old row from before runs existed)
    if job.status == JobStatus.PENDING:
        # Queued but never started. Safe to replace: the old job exits when it sees its run
        # was replaced, so it never calls the API, and its run is refunded.
        if job.run.created_at > now - STUCK_AFTER:
            return BUSY
        AnalysisRun.objects.filter(id=job.run_id).update(refunded=True)
    elif (job.started_at or job.run.created_at) > now - STUCK_AFTER:
        # Running. If it's stuck it may already have been billed, so its run is kept when replaced.
        return BUSY
    return None


def _reserve(user, kind, lock_job, start_job, run_fields):
    """
    The shared steps for starting a job. Runs under a lock on the user's profile (so two requests
    can't both take the last slot) and on the job's row (so a queued job's claim can't interleave).
    """
    now = timezone.now()
    get_profile(user)  # make sure the row exists before locking it
    with transaction.atomic():
        profile = Profile.objects.select_for_update().get(user=user)
        if _check_existing_job(lock_job(), now) == BUSY:
            return BUSY, None

        limit = plan_limit(profile.plan, kind)
        if limit is not None and _window_stats(user, kind, now)["used"] >= limit:
            return LIMITED, None

        run = AnalysisRun.objects.create(user=user, kind=kind, free=not ai.ai_enabled(), **run_fields)
        start_job(run)
        return QUEUED, run


def reserve_analysis(user, rnd):
    """Starts an analysis of the round if allowed. Returns (QUEUED, run), (LIMITED, None) or (BUSY, None)."""

    def start(run):
        RoundAnalysis.objects.update_or_create(
            round=rnd,
            defaults={
                "status": JobStatus.PENDING, "error": "", "stale": False, "refunded": False,
                "run": run, "started_at": None,
            },
        )

    return _reserve(
        user, ANALYSIS,
        lock_job=lambda: RoundAnalysis.objects.select_for_update(of=("self",)).select_related("run").filter(round=rnd).first(),
        start_job=start,
        run_fields={"round": rnd},
    )


def reserve_prep_plan(user, plan):
    """Starts generating the plan if allowed. Returns (QUEUED, run), (LIMITED, None) or (BUSY, None)."""

    def start(run):
        PrepPlan.objects.filter(pk=plan.pk).update(
            status=JobStatus.PENDING, error="", refunded=False, run=run, started_at=None
        )

    return _reserve(
        user, PREP_PLAN,
        lock_job=lambda: PrepPlan.objects.select_for_update(of=("self",)).select_related("run").filter(pk=plan.pk).first(),
        start_job=start,
        run_fields={"prep_plan": plan},
    )


def mark_stale(rnd):
    """The debrief changed but no new analysis could start: flag the old one as out of date."""
    RoundAnalysis.objects.filter(round=rnd).exclude(status__in=IN_PROGRESS).update(stale=True)
