"""
Limits on paid AI jobs, per plan: round analyses and prep plans.

Usage is counted over a rolling 24-hour window: each job frees up again 24 hours
after it started. Failures that weren't the user's fault are refunded (see refund_run
and tasks.py); refunds of failures that already cost an API call are capped. Jobs the
user's own text makes fail (refused, cut off) count. A job can't be started twice: a
second request while one is queued or running gets BUSY and counts nothing.

The plan, and so the limits, come from billing.entitlements, so the web app and the
browser extension (which call the same endpoints) get the same limits.
"""
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Min
from django.utils import timezone

from accounts.models import Profile, get_profile
from billing import entitlements

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

# How each kind is named in messages, what "at the limit" means for the user, and its feature id in 429s.
_WORDING = {
    ANALYSIS: ("analyses", "Your debrief is saved; you can analyse it once one frees up.", "ai_round_analysis"),
    PREP_PLAN: ("prep plans", "You can make or regenerate a plan once one frees up.", "ai_prep_plan"),
}


def plan_limit(tier, kind=ANALYSIS):
    """
    Jobs of this kind allowed per 24 hours on this tier (billing.tiers.Tier), or None for unlimited.
    The limits are cost control, so when the tier's jobs use the free rule-based engine nothing is limited.
    """
    if entitlements.ai_route(tier) is None:
        return None
    return tier.analyses_per_24h if kind == ANALYSIS else tier.prep_plans_per_24h


def _window_stats(user, kind, now):
    return AnalysisRun.objects.filter(
        user=user, kind=kind, refunded=False, free=False, created_at__gt=now - WINDOW
    ).aggregate(used=Count("id"), oldest=Min("created_at"))


def _quota(user, tier, kind, now):
    limit = plan_limit(tier, kind)
    stats = _window_stats(user, kind, now)
    return {
        "limit": limit,
        "used": stats["used"],
        "remaining": None if limit is None else max(0, limit - stats["used"]),
        # When the oldest run in the window expires, freeing one up.
        "next_available_at": (stats["oldest"] + WINDOW).isoformat() if stats["oldest"] and limit is not None else None,
        # Shown as "Unlimited, fair use"; `limit` is the fair-use allowance actually enforced.
        "fair_use": kind == ANALYSIS and tier.analyses_fair_use,
    }


def usage(user):
    """The user's plan and what they have left of each limited job."""
    tier = entitlements.for_user(user)
    route = entitlements.ai_route(tier)
    now = timezone.now()
    return {
        "plan": tier.code,
        "plan_name": tier.name,
        # False when this plan's jobs use the free rule-based engine (no suitable key): the limits are off.
        "ai_enabled": route is not None,
        # The key is on Gemini's free tier: Google may use what's sent to improve its products, so the app says so.
        "ai_free_tier": bool(route and route.provider_may_train),
        # This plan's debriefs may be used for training (product policy), which the app must tell the user.
        "training_notice": tier.debriefs_may_train,
        "ai_model": tier.ai_model_label,
        "priority": tier.priority,
        "analyses": _quota(user, tier, ANALYSIS, now),
        "prep_plans": _quota(user, tier, PREP_PLAN, now),
    }


def limit_message(user, kind=ANALYSIS):
    tier = entitlements.for_user(user)
    noun, next_step, _ = _WORDING[kind]
    return f"You've used all {plan_limit(tier, kind)} {noun} allowed in 24 hours on the {tier.name} plan. {next_step}"


def limit_details(user, kind=ANALYSIS):
    """The body of a 429 for this kind of job: the message, plus the numbers for the app to show."""
    tier = entitlements.for_user(user)
    quota = _quota(user, tier, kind, timezone.now())
    return {
        "detail": limit_message(user, kind),
        "code": "usage_limit",
        "feature": _WORDING[kind][2],
        "plan": tier.code,
        "limit": quota["limit"],
        "used": quota["used"],
        "reset_at": quota["next_available_at"],
    }


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
        Profile.objects.select_for_update().get(user=user)
        if _check_existing_job(lock_job(), now) == BUSY:
            return BUSY, None

        tier = entitlements.for_user(user, now)
        limit = plan_limit(tier, kind)
        if limit is not None and _window_stats(user, kind, now)["used"] >= limit:
            return LIMITED, None

        route = entitlements.ai_route(tier)
        run = AnalysisRun.objects.create(
            user=user, kind=kind, free=route is None, tier=tier.code,
            model=route.model if route else "", priority=tier.priority, **run_fields,
        )
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
