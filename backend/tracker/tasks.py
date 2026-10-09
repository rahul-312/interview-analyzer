from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from . import ai
from .insights import weak_spots
from .models import AnalysisRun, InterviewRound, JobStatus, PrepPlan, PrepTask, RoundAnalysis

MAX_PLAN_DAYS = 14


def queue(task, *args):
    """Run the task only after the current transaction commits, so the worker sees the saved rows."""
    transaction.on_commit(lambda: task.delay(*args))


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


@shared_task
def analyze_round_task(round_id, run_id=None):
    rnd = InterviewRound.objects.select_related("application", "debrief").get(id=round_id)
    analysis, _ = RoundAnalysis.objects.get_or_create(round=rnd)
    analysis.status = JobStatus.RUNNING
    analysis.error = ""
    analysis.save(update_fields=["status", "error", "updated_at"])
    try:
        result, source = ai.analyze_round(build_analysis_context(rnd))
        analysis.summary = result["summary"]
        analysis.score = result["score"]
        analysis.strengths = result["strengths"]
        analysis.weaknesses = result["weaknesses"]
        analysis.answer_reviews = result["answer_reviews"]
        analysis.source = source
        analysis.status = JobStatus.DONE
    except Exception as exc:  # store any failure so the UI can show it
        analysis.status = JobStatus.FAILED
        analysis.error = str(exc)[:1000]
        # A failed analysis doesn't count against the daily limit.
        if run_id:
            AnalysisRun.objects.filter(id=run_id).delete()
    analysis.save()


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
def generate_plan_task(plan_id):
    plan = PrepPlan.objects.select_related("application", "target_round", "user").get(id=plan_id)
    plan.status = JobStatus.RUNNING
    plan.error = ""
    plan.save(update_fields=["status", "error"])
    try:
        context = build_plan_context(plan)
        result, source = ai.generate_plan(context)
        start = timezone.localdate()
        with transaction.atomic():
            plan.tasks.all().delete()
            PrepTask.objects.bulk_create([
                PrepTask(
                    plan=plan,
                    date=start + timedelta(days=t["day"] - 1),
                    topic=t["topic"][:200],
                    title=t["title"][:300],
                    detail=t["detail"],
                    minutes=t["minutes"],
                )
                for t in result["tasks"]
            ])
            plan.summary = result["summary"]
            plan.source = source
            plan.status = JobStatus.DONE
            plan.save()
    except Exception as exc:
        plan.status = JobStatus.FAILED
        plan.error = str(exc)[:1000]
        plan.save(update_fields=["status", "error"])
