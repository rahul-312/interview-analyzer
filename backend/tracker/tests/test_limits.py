from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from accounts.models import Profile, get_profile
from tracker.models import AnalysisRun, InterviewRound, JobStatus, RoundAnalysis

pytestmark = pytest.mark.django_db


def past(days=2):
    return (timezone.now() - timedelta(days=days)).isoformat()


def debrief(question="Design a cache", confidence=2):
    return {"questions": [{"question": question, "answer": "...", "topic": "system design", "confidence": confidence}]}


def log_round(api, application, run_jobs, question="Design a cache"):
    with run_jobs():
        res = api.post("/api/rounds/", {
            "application": application.id, "round_type": "technical",
            "scheduled_at": past(), "debrief": debrief(question),
        }, format="json")
    assert res.status_code == 201, res.data
    return res


def test_free_plan_gets_two_analyses_then_round_is_saved_without_one(api, application, run_jobs):
    assert not log_round(api, application, run_jobs, "Q1").data["analysis_limited"]
    assert not log_round(api, application, run_jobs, "Q2").data["analysis_limited"]

    res = log_round(api, application, run_jobs, "Q3")
    assert res.data["analysis_limited"] is True
    assert "2 analyses" in res.data["analysis_limit_message"]
    # The round and its debrief are kept; only the analysis is skipped.
    third = InterviewRound.objects.get(id=res.data["id"])
    assert third.debrief.questions[0]["question"] == "Q3"
    assert not RoundAnalysis.objects.filter(round=third).exists()

    # The analyze button is refused too.
    res = api.post(f"/api/rounds/{third.id}/analyze/")
    assert res.status_code == 429
    assert AnalysisRun.objects.filter(user=application.user).count() == 2


def test_usage_is_reported_on_me(api, application, run_jobs):
    usage = api.get("/api/auth/me/").data["usage"]
    assert usage == {"plan": "free", "limit": 2, "used": 0, "remaining": 2, "next_available_at": None}

    log_round(api, application, run_jobs)
    usage = api.get("/api/auth/me/").data["usage"]
    assert usage["used"] == 1 and usage["remaining"] == 1
    assert usage["next_available_at"] is not None


def test_analyses_free_up_after_24_hours(api, application, run_jobs):
    log_round(api, application, run_jobs, "Q1")
    log_round(api, application, run_jobs, "Q2")
    AnalysisRun.objects.update(created_at=timezone.now() - timedelta(hours=25))

    assert not log_round(api, application, run_jobs, "Q3").data["analysis_limited"]


def test_pro_plan_is_unlimited(api, application, run_jobs, user):
    Profile.objects.update_or_create(user=user, defaults={"plan": Profile.Plan.PRO})
    for i in range(4):
        assert not log_round(api, application, run_jobs, f"Q{i}").data["analysis_limited"]
    assert api.get("/api/auth/me/").data["usage"]["remaining"] is None


def test_failed_analysis_is_refunded(api, application, run_jobs):
    with mock.patch("tracker.ai.analyze_round", side_effect=RuntimeError("API down")):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert AnalysisRun.objects.count() == 0
    assert api.get("/api/auth/me/").data["usage"]["remaining"] == 2


def test_editing_round_without_changing_debrief_does_not_use_an_analysis(api, application, run_jobs):
    res = log_round(api, application, run_jobs)
    rnd = res.data

    # The edit form re-sends the same debrief along with the new outcome.
    with run_jobs():
        res = api.patch(f"/api/rounds/{rnd['id']}/", {"outcome": "passed", "debrief": debrief()}, format="json")
    assert res.status_code == 200
    assert AnalysisRun.objects.count() == 1

    # Changing the debrief does run a new analysis.
    with run_jobs():
        api.patch(f"/api/rounds/{rnd['id']}/", {"debrief": debrief(confidence=1)}, format="json")
    assert AnalysisRun.objects.count() == 2


def test_new_users_start_on_free_plan(user):
    assert get_profile(user).plan == "free"
