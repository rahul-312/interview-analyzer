import json
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx2
import pytest
from django.utils import timezone

from accounts.models import Profile, get_profile
from tracker import ai
from tracker.models import AnalysisRun, Debrief, InterviewRound, JobStatus, RoundAnalysis
from tracker.tasks import analyze_round_task

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


# ---------------------------------------------------------------------------
# Refunds: only failures where nothing was billed
# ---------------------------------------------------------------------------

_REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _reply(stop_reason="end_turn", text=None):
    text = text if text is not None else json.dumps(
        {"summary": "ok", "score": 70, "strengths": [], "weaknesses": [], "answer_reviews": []}
    )
    return SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)])


def _fake_client(outcome):
    def create(**kwargs):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))


@pytest.fixture
def with_ai(settings):
    settings.ANTHROPIC_API_KEY = "sk-ant-test"


@pytest.mark.parametrize("outcome", [
    _reply(stop_reason="refusal"),
    _reply(stop_reason="max_tokens"),
    _reply(text="not json"),
    anthropic.APITimeoutError(request=_REQ),
], ids=["refusal", "cut-off", "bad-json", "timeout"])
def test_billed_failures_still_count(api, application, run_jobs, with_ai, outcome):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(outcome)):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert AnalysisRun.objects.count() == 1


@pytest.mark.parametrize("outcome", [
    anthropic.APIConnectionError(request=_REQ),
    anthropic.RateLimitError("rate limited", response=httpx2.Response(429, request=_REQ), body=None),
    anthropic.OverloadedError("overloaded", response=httpx2.Response(529, request=_REQ), body=None),
], ids=["connection", "429", "529"])
def test_unbilled_failures_are_refunded(api, application, run_jobs, with_ai, outcome):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(outcome)):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED
    assert "unavailable" in analysis.error
    assert AnalysisRun.objects.count() == 0


# ---------------------------------------------------------------------------
# Duplicate and stuck analyses
# ---------------------------------------------------------------------------

def _round_with_queued_analysis(api, application):
    # Without run_jobs() the queued task never runs, so the analysis stays pending.
    res = api.post("/api/rounds/", {
        "application": application.id, "round_type": "technical",
        "scheduled_at": past(), "debrief": debrief(),
    }, format="json")
    assert res.data["analysis"]["status"] == "pending"
    return res.data["id"]


def test_analyze_while_already_queued_is_rejected(api, application):
    round_id = _round_with_queued_analysis(api, application)

    res = api.post(f"/api/rounds/{round_id}/analyze/")
    assert res.status_code == 409
    assert AnalysisRun.objects.count() == 1


def test_stuck_analysis_releases_its_run_and_can_restart(api, application):
    round_id = _round_with_queued_analysis(api, application)
    stuck_run = AnalysisRun.objects.get()
    RoundAnalysis.objects.filter(round_id=round_id).update(updated_at=timezone.now() - timedelta(minutes=20))

    res = api.post(f"/api/rounds/{round_id}/analyze/")
    assert res.status_code == 202
    assert not AnalysisRun.objects.filter(id=stuck_run.id).exists()
    assert AnalysisRun.objects.count() == 1


# ---------------------------------------------------------------------------
# Out-of-date analyses
# ---------------------------------------------------------------------------

def test_changed_debrief_at_limit_marks_analysis_stale(api, application, run_jobs):
    first = log_round(api, application, run_jobs, "Q1").data
    log_round(api, application, run_jobs, "Q2")

    with run_jobs():
        res = api.patch(f"/api/rounds/{first['id']}/", {"debrief": debrief("Q1 edited")}, format="json")
    assert res.data["analysis_limited"] is True
    assert res.data["analysis"]["stale"] is True

    # Once an analysis frees up, analysing again clears the flag.
    AnalysisRun.objects.update(created_at=timezone.now() - timedelta(hours=25))
    with run_jobs():
        assert api.post(f"/api/rounds/{first['id']}/analyze/").status_code == 202
    assert RoundAnalysis.objects.get(round_id=first["id"]).stale is False


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

def test_profile_is_created_at_sign_up():
    from rest_framework.test import APIClient

    res = APIClient().post("/api/auth/register/", {"username": "newbie", "password": "a-strong-pass-123"}, format="json")
    assert res.status_code == 201
    assert Profile.objects.get(user_id=res.data["id"]).plan == "free"


def test_me_does_not_write(api, user):
    Profile.objects.filter(user=user).delete()
    assert api.get("/api/auth/me/").data["usage"]["plan"] == "free"
    assert not Profile.objects.filter(user=user).exists()


# ---------------------------------------------------------------------------
# Jobs only write while they are still the current job for the round
# ---------------------------------------------------------------------------

def test_debrief_edited_while_running_saves_result_as_stale(api, application, run_jobs):
    real_analyze = ai.analyze_round

    def edit_during_run(context):
        # The user saves a new debrief while the AI call is in flight.
        Debrief.objects.filter(round__application=application).update(
            went_badly="edited mid-run", updated_at=timezone.now() + timedelta(seconds=1)
        )
        return real_analyze(context)

    with mock.patch.object(ai, "analyze_round", side_effect=edit_during_run):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.DONE
    assert analysis.stale is True


def test_replaced_queued_job_never_runs(api, application):
    round_id = _round_with_queued_analysis(api, application)
    old_run = AnalysisRun.objects.get()
    RoundAnalysis.objects.filter(round_id=round_id).update(updated_at=timezone.now() - timedelta(minutes=20))
    assert api.post(f"/api/rounds/{round_id}/analyze/").status_code == 202
    new_run = AnalysisRun.objects.get()

    # The backed-up queue finally delivers the old job: it must not call the API or touch anything.
    with mock.patch.object(ai, "analyze_round") as analyze:
        analyze_round_task(round_id, old_run.id)
    analyze.assert_not_called()
    analysis = RoundAnalysis.objects.get(round_id=round_id)
    assert (analysis.run_id, analysis.status) == (new_run.id, JobStatus.PENDING)


def test_replaced_running_job_is_discarded_and_keeps_its_charge(api, application, run_jobs):
    round_id = _round_with_queued_analysis(api, application)
    old_run = AnalysisRun.objects.get()

    def replaced_mid_run(context):
        # While this job is in the AI call, it gets treated as stuck and a new analysis starts.
        RoundAnalysis.objects.filter(round_id=round_id).update(started_at=timezone.now() - timedelta(minutes=20))
        assert api.post(f"/api/rounds/{round_id}/analyze/").status_code == 202
        return {"summary": "old job", "score": 10, "strengths": [], "weaknesses": [], "answer_reviews": []}, "ai"

    with mock.patch.object(ai, "analyze_round", side_effect=replaced_mid_run):
        analyze_round_task(round_id, old_run.id)  # must not crash on the replaced run

    analysis = RoundAnalysis.objects.get(round_id=round_id)
    assert analysis.summary != "old job"  # the old result was discarded
    assert analysis.status == JobStatus.PENDING and analysis.run_id != old_run.id
    # The old job may have been billed, so both runs count.
    assert AnalysisRun.objects.filter(id=old_run.id).exists()
    assert AnalysisRun.objects.count() == 2


def test_error_before_api_call_is_refunded(api, application, run_jobs, with_ai):
    with mock.patch("tracker.tasks.build_analysis_context", side_effect=ValueError("bad data")):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert AnalysisRun.objects.count() == 0


def test_loaddata_with_profile_fixture(tmp_path):
    from django.core.management import call_command

    fixture = tmp_path / "users.json"
    fixture.write_text(json.dumps([
        {"model": "auth.user", "pk": 900, "fields": {"username": "fixture_user", "password": "!"}},
        {"model": "accounts.profile", "pk": 900, "fields": {"user": 900, "plan": "pro"}},
    ]))
    call_command("loaddata", str(fixture), verbosity=0)
    assert Profile.objects.get(user_id=900).plan == "pro"
