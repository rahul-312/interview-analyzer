from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from billing import entitlements, tiers

from . import ai
from .insights import weak_spots
from .models import AnalysisRun, Debrief, InterviewRound, JobStatus, PrepPlan, PrepTask, RoundAnalysis
from .usage import refund_run

MAX_PLAN_DAYS = 14


def queue(task, *args, priority=False):
    """
    Run the task only after the current transaction commits, so the worker sees the saved rows.
    Priority jobs (Pro Plus) go on their own queue, which a dedicated worker serves first.
    """
    options = {"queue": settings.CELERY_PRIORITY_QUEUE} if priority else {}
    transaction.on_commit(lambda: task.apply_async(args=args, **options))


def build_analysis_context(rnd):
    app = rnd.application
    d = rnd.debrief
    return {
        "company": app.company,
        "role": app.role,
        "job_description": app.job_description,
        "round_type": rnd.get_round_type_display(),
        "date": rnd.scheduled_at.date().isoformat(),
        "outcome": rnd.outcome,
        "debrief": {
            "questions": d.questions,
            "went_well": d.went_well,
            "went_badly": d.went_badly,
            "interviewer_cues": d.interviewer_cues,
            "recruiter_feedback": d.recruiter_feedback,
            "overall_feeling": d.overall_feeling,
        },
    }


def _settle_route(run_id):
    """
    Picks the Gemini key and model for this run from the plan it was started on, and records whether
    it's free from what actually happens now: with no suitable key the rule-based fallback runs (free);
    with one it's a paid call that counts, even if it was queued without one. Returns the route
    (None for rule-based).
    """
    run = AnalysisRun.objects.filter(id=run_id).select_related("user").first() if run_id else None
    if run is None:
        # Queued by an older deploy, before runs existed: treat it as a free-plan job.
        return entitlements.ai_route(tiers.get_tier(tiers.FREE))
    tier = tiers.get_tier(run.tier) if run.tier else entitlements.for_user(run.user)
    route = entitlements.ai_route(tier)
    AnalysisRun.objects.filter(id=run_id).update(free=route is None, model=route.model if route else "")
    return route


def _refund_kind(exc, billing):
    """None (counts), "free" or "billed": which refund, if any, a failed job gets."""
    if isinstance(exc, ai.UserCaused):
        return None  # refused or cut off: the user's text can cause these on purpose, so they count
    if isinstance(exc, ai.NotCharged) or not billing.api_called:
        return "free"  # nothing reached the paid API (or the free rule-based fallback failed)
    return "billed"  # our side failed after a paid call: give it back, within the cap


@shared_task
def analyze_round_task(round_id, run_id=None):
    """
    Analyses a round. Only the job whose run is on the RoundAnalysis may run or write:
    if a newer analysis replaced this one, it does nothing and its result is discarded.

    `run_id` defaults to None so jobs queued before runs existed (older deploys) still claim
    their row, which has no run.
    """
    now = timezone.now()
    # Claim the analysis atomically. Zero rows means this job was replaced or already ran.
    claimed = RoundAnalysis.objects.filter(round_id=round_id, run_id=run_id, status=JobStatus.PENDING).update(
        status=JobStatus.RUNNING, started_at=now, error="", updated_at=now
    )
    if not claimed:
        return
    route = _settle_route(run_id)

    billing = ai.Billing()
    refund = None  # None, "free" or "billed"
    try:
        rnd = InterviewRound.objects.select_related("application", "debrief").get(id=round_id)
        debrief_version = rnd.debrief.updated_at
        result, source = ai.analyze_round(build_analysis_context(rnd), billing, route)
        fields = {
            "summary": result["summary"],
            "score": result["score"],
            "strengths": result["strengths"],
            "weaknesses": result["weaknesses"],
            "answer_reviews": result["answer_reviews"],
            "source": source,
            "status": JobStatus.DONE,
            # Edited while this ran: the result describes the old debrief.
            "stale": Debrief.objects.filter(round_id=round_id).values_list("updated_at", flat=True).first()
            != debrief_version,
        }
    except Exception as exc:  # store any failure so the UI can show it
        fields = {"status": JobStatus.FAILED, "error": str(exc)[:1000]}
        refund = _refund_kind(exc, billing)

    # Write only if this is still the current job for the round.
    written = RoundAnalysis.objects.filter(round_id=round_id, run_id=run_id).update(**fields, updated_at=timezone.now())
    if refund and run_id and refund_run(run_id, billed=refund == "billed") and written:
        RoundAnalysis.objects.filter(round_id=round_id, run_id=run_id).update(refunded=True)


def build_plan_context(plan):
    app = plan.application
    today = timezone.localdate()
    days = max(1, min(MAX_PLAN_DAYS, (plan.interview_date - today).days))
    round_type = plan.target_round.round_type if plan.target_round else None
    return {
        "company": app.company,
        "role": app.role,
        "job_description": app.job_description,
        "round_type": round_type,
        "interview_date": plan.interview_date.isoformat(),
        "days": days,
        "weak_spots": [
            {"topic": w["topic"], "count": w["count"], "high_count": w["high_count"], "advice": w["latest_advice"]}
            for w in weak_spots(plan.user)[:8]
        ],
    }


@shared_task
def generate_plan_task(plan_id, run_id=None):
    """
    Generates a plan's tasks. Like analyze_round_task, only the job whose run is on the plan may
    run or write. `run_id` defaults to None for jobs queued before runs existed.
    """
    now = timezone.now()
    claimed = PrepPlan.objects.filter(id=plan_id, run_id=run_id, status=JobStatus.PENDING).update(
        status=JobStatus.RUNNING, started_at=now, error=""
    )
    if not claimed:
        return
    route = _settle_route(run_id)

    billing = ai.Billing()
    refund = None
    try:
        plan = PrepPlan.objects.select_related("application", "target_round", "user").get(id=plan_id)
        result, source = ai.generate_plan(build_plan_context(plan), billing, route)
        start = timezone.localdate()
        new_tasks = [
            PrepTask(
                plan_id=plan_id,
                date=start + timedelta(days=t["day"] - 1),
                topic=t["topic"][:200],
                title=t["title"][:300],
                detail=t["detail"],
                minutes=t["minutes"],
            )
            for t in result["tasks"]
        ]
        with transaction.atomic():
            # Replace the tasks only if this is still the current job for the plan.
            if PrepPlan.objects.select_for_update().filter(id=plan_id, run_id=run_id).exists():
                PrepTask.objects.filter(plan_id=plan_id).delete()
                PrepTask.objects.bulk_create(new_tasks)
                PrepPlan.objects.filter(id=plan_id).update(
                    summary=result["summary"], resources=result.get("resources", []), source=source,
                    status=JobStatus.DONE,
                )
    except Exception as exc:  # store any failure so the UI can show it
        refund = _refund_kind(exc, billing)
        written = PrepPlan.objects.filter(id=plan_id, run_id=run_id).update(
            status=JobStatus.FAILED, error=str(exc)[:1000]
        )
        if refund and run_id and refund_run(run_id, billed=refund == "billed") and written:
            PrepPlan.objects.filter(id=plan_id, run_id=run_id).update(refunded=True)
