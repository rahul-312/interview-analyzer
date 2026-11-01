import json
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import httpx
import pytest
from django.utils import timezone
from google.genai import errors

from accounts.models import Profile, get_profile
from tracker import ai
from tracker.models import AnalysisRun, Debrief, InterviewRound, JobStatus, PrepPlan, RoundAnalysis
from tracker.tasks import analyze_round_task, generate_plan_task

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fake_ai(settings):
    """
    Limits are cost control and only apply with an API key, so these tests run "with AI":
    a fake client returns a valid analysis or plan, depending on the schema asked for.
    Tests that need a specific reply or error patch get_client themselves.
    """
    settings.GEMINI_API_KEY = "test-key"

    def create(**kwargs):
        schema = kwargs["config"].response_json_schema
        if "tasks" in schema["properties"]:
            body = {"summary": "plan", "tasks": [
                {"day": 1, "topic": "sql", "title": "Practise joins", "detail": "...", "minutes": 30},
            ]}
        else:
            body = {"summary": "ok", "score": 60, "strengths": [], "answer_reviews": [], "weaknesses": [
                {"topic": "system design", "severity": "high", "evidence": "...", "advice": "..."},
            ]}
        return _reply(text=json.dumps(body))

    client = SimpleNamespace(models=SimpleNamespace(generate_content=create))
    with mock.patch.object(ai, "get_client", return_value=client):
        yield


def counted_runs():
    """Runs that count against the limit; refunded ones stay in the table for the record."""
    return AnalysisRun.objects.filter(refunded=False).count()


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
    assert counted_runs() == 2


def test_usage_is_reported_on_me(api, application, run_jobs):
    fresh = {"limit": 2, "used": 0, "remaining": 2, "next_available_at": None, "fair_use": False}
    fresh_plans = {"limit": 1, "used": 0, "remaining": 1, "next_available_at": None, "fair_use": False}
    assert api.get("/api/auth/me/").data["usage"] == {
        "plan": "free", "plan_name": "Free", "ai_enabled": True, "ai_free_tier": True, "training_notice": True,
        "ai_model": "Flash", "priority": False, "analyses": fresh, "prep_plans": fresh_plans,
    }

    log_round(api, application, run_jobs)
    usage = api.get("/api/auth/me/").data["usage"]
    assert usage["analyses"]["used"] == 1 and usage["analyses"]["remaining"] == 1
    assert usage["analyses"]["next_available_at"] is not None
    assert usage["prep_plans"] == fresh_plans  # counted separately


def test_analyses_free_up_after_24_hours(api, application, run_jobs):
    log_round(api, application, run_jobs, "Q1")
    log_round(api, application, run_jobs, "Q2")
    AnalysisRun.objects.update(created_at=timezone.now() - timedelta(hours=25))

    assert not log_round(api, application, run_jobs, "Q3").data["analysis_limited"]


def test_pro_plan_gets_its_own_limit(api, application, run_jobs, user, settings):
    settings.GEMINI_FREE_TIER = False  # paid plans only use a paid-tier key
    Profile.objects.update_or_create(user=user, defaults={"plan": Profile.Plan.PRO})
    for i in range(4):
        assert not log_round(api, application, run_jobs, f"Q{i}").data["analysis_limited"]
    analyses = api.get("/api/auth/me/").data["usage"]["analyses"]
    assert analyses["limit"] == 15 and analyses["remaining"] == 11


def test_failed_analysis_is_refunded(api, application, run_jobs):
    with mock.patch("tracker.ai.analyze_round", side_effect=RuntimeError("API down")):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert counted_runs() == 0
    assert api.get("/api/auth/me/").data["usage"]["analyses"]["remaining"] == 2


def test_editing_round_without_changing_debrief_does_not_use_an_analysis(api, application, run_jobs):
    res = log_round(api, application, run_jobs)
    rnd = res.data

    # The edit form re-sends the same debrief along with the new outcome.
    with run_jobs():
        res = api.patch(f"/api/rounds/{rnd['id']}/", {"outcome": "passed", "debrief": debrief()}, format="json")
    assert res.status_code == 200
    assert counted_runs() == 1

    # Changing the debrief does run a new analysis.
    with run_jobs():
        api.patch(f"/api/rounds/{rnd['id']}/", {"debrief": debrief(confidence=1)}, format="json")
    assert counted_runs() == 2


def test_new_users_start_on_free_plan(user):
    assert get_profile(user).plan == "free"


# ---------------------------------------------------------------------------
# Refunds: only failures where nothing was billed
# ---------------------------------------------------------------------------

_REQ = httpx.Request("POST", "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent")
_real_get_client = ai.get_client  # before the fake_ai fixture replaces it


def _reply(finish_reason="STOP", text=None, block_reason=None):
    text = text if text is not None else json.dumps(
        {"summary": "ok", "score": 70, "strengths": [], "weaknesses": [], "answer_reviews": []}
    )
    return SimpleNamespace(
        prompt_feedback=SimpleNamespace(block_reason=block_reason) if block_reason else None,
        candidates=[] if block_reason else [SimpleNamespace(finish_reason=finish_reason)],
        text=None if block_reason else text,
    )


def _api_error(code, status, details=None):
    cls = errors.ClientError if code < 500 else errors.ServerError
    error = {"code": code, "message": status.lower(), "status": status}
    if details:
        error["details"] = details
    return cls(code, {"error": error})


def _out_of_daily_quota():
    return _api_error(429, "RESOURCE_EXHAUSTED", [{
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}],
    }])


def _fake_client(outcome):
    def create(**kwargs):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome
    return SimpleNamespace(models=SimpleNamespace(generate_content=create))


@pytest.fixture
def with_ai(settings):
    settings.GEMINI_API_KEY = "test-key"


def test_refusal_counts(api, application, run_jobs, with_ai):
    # The AI declined what the user wrote: that's on the user, so it counts.
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(finish_reason="SAFETY"))):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED and analysis.refunded is False
    assert counted_runs() == 1


@pytest.mark.parametrize("reply", [
    _reply(finish_reason="SAFETY"),
    _reply(block_reason="PROHIBITED_CONTENT"),
    _reply(finish_reason="MAX_TOKENS"),
], ids=["blocked-reply", "blocked-prompt", "cut-off"])
def test_failures_the_user_can_cause_count(api, application, run_jobs, with_ai, reply):
    # Blocked content, or a reply cut off at max_tokens (e.g. "write 20,000 words about..."), counts.
    with mock.patch.object(ai, "get_client", return_value=_fake_client(reply)):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED and analysis.refunded is False
    assert counted_runs() == 1


@pytest.mark.parametrize("outcome", [
    _reply(text="not json"),
    httpx.ReadTimeout("timed out", request=_REQ),
], ids=["bad-json", "timeout"])
def test_our_side_failures_after_a_paid_call_are_given_back(api, application, run_jobs, with_ai, outcome):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(outcome)):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED and analysis.refunded is True
    assert counted_runs() == 0
    assert AnalysisRun.objects.get().billed is True  # counts towards the refund cap


def test_billed_refunds_are_capped(api, application, run_jobs, with_ai, settings):
    settings.BILLED_REFUNDS_PER_24H = 1
    unreadable = _reply(text="not json")
    with mock.patch.object(ai, "get_client", return_value=_fake_client(unreadable)):
        first = log_round(api, application, run_jobs, "Q1")
        second = log_round(api, application, run_jobs, "Q2")
    assert RoundAnalysis.objects.get(round_id=first.data["id"]).refunded is True
    # Past the cap the failure counts, so an expensive failure can't be retried for free.
    assert RoundAnalysis.objects.get(round_id=second.data["id"]).refunded is False
    assert counted_runs() == 1


def test_unbilled_refunds_are_not_capped(api, application, run_jobs, with_ai, settings):
    settings.BILLED_REFUNDS_PER_24H = 0
    down = httpx.ConnectError("down", request=_REQ)
    with mock.patch.object(ai, "get_client", return_value=_fake_client(down)):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).refunded is True
    assert counted_runs() == 0


@pytest.mark.parametrize("outcome,message", [
    (httpx.ConnectError("down", request=_REQ), "couldn't reach the AI service"),
    (_api_error(429, "RESOURCE_EXHAUSTED"), "busy right now"),
    (_api_error(503, "UNAVAILABLE"), "busy right now"),
], ids=["connection", "429", "503"])
def test_unbilled_failures_are_refunded(api, application, run_jobs, with_ai, outcome, message):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(outcome)):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED
    # Plain words for the user; the exception's class name is only in the log
    assert message in analysis.error and "ConnectError" not in analysis.error
    assert counted_runs() == 0


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
    assert counted_runs() == 1


def test_stuck_analysis_releases_its_run_and_can_restart(api, application):
    round_id = _round_with_queued_analysis(api, application)
    stuck_run = AnalysisRun.objects.get(refunded=False)
    AnalysisRun.objects.filter(round_id=round_id).update(created_at=timezone.now() - timedelta(minutes=20))

    res = api.post(f"/api/rounds/{round_id}/analyze/")
    assert res.status_code == 202
    assert AnalysisRun.objects.get(id=stuck_run.id).refunded
    assert counted_runs() == 1


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


@pytest.fixture
def signup_limits(settings):
    from django.core.cache import cache
    from rest_framework.throttling import SimpleRateThrottle

    # Keep the other rates: a throttle without one raises ImproperlyConfigured
    rates = {**SimpleRateThrottle.THROTTLE_RATES, "signup": "2/hour", "signup_attempt": "1000/min"}
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 0}  # whatever the local .env says
    cache.clear()
    # DRF reads the rates once at import, so patch them on the class
    with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", rates):
        yield rates
    cache.clear()


def sign_up(username, password="a-strong-pass-123", **headers):
    return post_sign_up(username, password, **headers).status_code


def post_sign_up(username, password="a-strong-pass-123", **headers):
    from rest_framework.test import APIClient

    return APIClient().post("/api/auth/register/", {"username": username, "password": password}, format="json", **headers)


def test_sign_ups_are_throttled_per_ip(signup_limits):
    assert [sign_up(f"user{i}") for i in range(2)] == [201, 201]
    res = post_sign_up("user2")
    assert res.status_code == 429
    assert res.data["detail"] == "Too many sign-ups from this network. Try again in an hour."
    assert res["Retry-After"]


@pytest.mark.parametrize("wait, when", [
    (30, "a minute"), (600, "10 minutes"), (3599, "an hour"), (86_000, "24 hours"),
])
def test_the_sign_up_limit_message_rounds_the_wait(wait, when):
    from rest_framework.exceptions import Throttled

    from accounts.views import RegisterView

    with pytest.raises(Throttled) as exc:
        RegisterView().throttled(None, wait)
    assert exc.value.detail == f"Too many sign-ups from this network. Try again in {when}."


def test_the_wait_is_known_even_when_over_the_limit():
    from accounts.throttles import SignupThrottle

    throttle = SignupThrottle()
    throttle.duration, throttle.num_requests, throttle.now = 3600, 2, 1000.0
    throttle.history = [990.0, 900.0, 800.0]  # three counted: simultaneous requests slipped past
    assert throttle.wait() == 3400.0


def test_a_made_up_forwarded_for_header_doesnt_dodge_the_sign_up_limit(signup_limits):
    codes = [sign_up(f"user{i}", HTTP_X_FORWARDED_FOR=f"203.0.113.{i}") for i in range(3)]
    assert codes == [201, 201, 429]


def test_rejected_sign_ups_dont_use_up_the_limit(signup_limits):
    assert sign_up("taken") == 201
    assert [sign_up("taken"), sign_up("weak", password="1")] == [400, 400]
    assert sign_up("second") == 201
    assert sign_up("third") == 429


def test_every_sign_up_attempt_has_a_looser_limit(signup_limits):
    signup_limits["signup_attempt"] = "3/min"
    assert [sign_up("taken"), sign_up("taken"), sign_up("taken"), sign_up("fresh")] == [201, 400, 400, 429]


def test_a_forwarded_for_header_with_no_proxies_set_is_logged_once(signup_limits, caplog):
    from accounts import throttles

    with mock.patch.object(throttles, "_warned_about_proxies", False):
        sign_up("user0", HTTP_X_FORWARDED_FOR="203.0.113.1")
        sign_up("user1", HTTP_X_FORWARDED_FOR="203.0.113.2")
    assert sum("NUM_PROXIES" in r.message for r in caplog.records) == 1


def test_me_does_not_write(api, user):
    Profile.objects.filter(user=user).delete()
    assert api.get("/api/auth/me/").data["usage"]["plan"] == "free"
    assert not Profile.objects.filter(user=user).exists()


# ---------------------------------------------------------------------------
# Jobs only write while they are still the current job for the round
# ---------------------------------------------------------------------------

def test_debrief_edited_while_running_saves_result_as_stale(api, application, run_jobs):
    real_analyze = ai.analyze_round

    def edit_during_run(context, billing=None, route=None):
        # The user saves a new debrief while the AI call is in flight.
        Debrief.objects.filter(round__application=application).update(
            went_badly="edited mid-run", updated_at=timezone.now() + timedelta(seconds=1)
        )
        return real_analyze(context, billing)

    with mock.patch.object(ai, "analyze_round", side_effect=edit_during_run):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.DONE
    assert analysis.stale is True


def test_replaced_queued_job_never_runs(api, application):
    round_id = _round_with_queued_analysis(api, application)
    old_run = AnalysisRun.objects.get(refunded=False)
    AnalysisRun.objects.filter(round_id=round_id).update(created_at=timezone.now() - timedelta(minutes=20))
    assert api.post(f"/api/rounds/{round_id}/analyze/").status_code == 202
    new_run = AnalysisRun.objects.get(refunded=False)

    # The backed-up queue finally delivers the old job: it must not call the API or touch anything.
    with mock.patch.object(ai, "analyze_round") as analyze:
        analyze_round_task(round_id, old_run.id)
    analyze.assert_not_called()
    analysis = RoundAnalysis.objects.get(round_id=round_id)
    assert (analysis.run_id, analysis.status) == (new_run.id, JobStatus.PENDING)


def test_replaced_running_job_is_discarded_and_keeps_its_charge(api, application, run_jobs):
    round_id = _round_with_queued_analysis(api, application)
    old_run = AnalysisRun.objects.get(refunded=False)

    def replaced_mid_run(context, billing=None, route=None):
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
    assert not AnalysisRun.objects.get(id=old_run.id).refunded
    assert counted_runs() == 2


def test_error_before_api_call_is_refunded(api, application, run_jobs, with_ai):
    with mock.patch("tracker.tasks.build_analysis_context", side_effect=ValueError("bad data")):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert counted_runs() == 0


def test_loaddata_with_profile_fixture(tmp_path):
    from django.core.management import call_command

    fixture = tmp_path / "users.json"
    fixture.write_text(json.dumps([
        {"model": "auth.user", "pk": 900, "fields": {"username": "fixture_user", "password": "!"}},
        {"model": "accounts.profile", "pk": 900, "fields": {"user": 900, "plan": "pro"}},
    ]))
    call_command("loaddata", str(fixture), verbosity=0)
    assert Profile.objects.get(user_id=900).plan == "pro"


# ---------------------------------------------------------------------------
# Refunds decided by where the failure happened
# ---------------------------------------------------------------------------

def _sequence_client(*outcomes):
    """A fake client that returns or raises each outcome in turn, and counts the calls."""
    calls = []

    def create(**kwargs):
        outcome = outcomes[len(calls)]
        calls.append(kwargs)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return SimpleNamespace(models=SimpleNamespace(generate_content=create)), calls


def _overloaded():
    return _api_error(503, "UNAVAILABLE")


@pytest.fixture(autouse=True)
def no_retry_sleep():
    with mock.patch.object(ai.time, "sleep"):
        yield


def test_sdk_validation_error_after_paid_reply_is_given_back(api, application, run_jobs, with_ai):
    # Raised by the SDK after a 200 (billed) response it can't parse; not a status/connection error.
    error = errors.UnknownApiResponseError("unreadable response")
    client, _ = _sequence_client(error)
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert counted_runs() == 0
    assert AnalysisRun.objects.get().billed is True  # a paid call was made: counts towards the refund cap


def test_failure_in_task_after_api_call_is_given_back(api, application, run_jobs, with_ai):
    # The reply parses, but the task fails while reading it (missing "summary").
    client, _ = _sequence_client(_reply(text=json.dumps({"score": 50})))
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert counted_runs() == 0
    assert AnalysisRun.objects.get().billed is True


def test_unbilled_errors_are_retried_then_succeed(api, application, run_jobs, with_ai, settings):
    settings.AI_RETRY_DELAYS = (1, 3)  # as with a broker
    client, calls = _sequence_client(_overloaded(), _reply())
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert len(calls) == 2
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.DONE
    assert counted_runs() == 1


def test_unbilled_errors_on_every_attempt_are_refunded(api, application, run_jobs, with_ai, settings):
    settings.AI_RETRY_DELAYS = (1, 3)
    client, calls = _sequence_client(_overloaded(), _overloaded(), _overloaded())
    with mock.patch.object(ai, "get_client", return_value=client):
        log_round(api, application, run_jobs)
    assert len(calls) == 3
    assert counted_runs() == 0


def test_timeout_is_not_retried_and_is_a_billed_refund(api, application, run_jobs, with_ai):
    # Not retried: a timeout may already have been paid for. Given back, but as a capped (billed) refund.
    client, calls = _sequence_client(httpx.ReadTimeout("timed out", request=_REQ), _reply())
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert len(calls) == 1
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).status == JobStatus.FAILED
    assert counted_runs() == 0
    assert AnalysisRun.objects.get().billed is True


def test_client_has_sdk_retries_disabled(with_ai):
    # Checked on what's passed to the SDK, not on its private attributes.
    with mock.patch("google.genai.Client") as client:
        _real_get_client()
    assert client.call_args.kwargs["http_options"].retry_options.attempts == 1


def test_job_queued_by_older_deploy_still_runs(api, application):
    # Before runs existed, jobs were queued as analyze_round_task(round_id) and rows had no run.
    round_id = _round_with_queued_analysis(api, application)
    RoundAnalysis.objects.filter(round_id=round_id).update(run=None)
    analyze_round_task(round_id)
    assert RoundAnalysis.objects.get(round_id=round_id).status == JobStatus.DONE


# ---------------------------------------------------------------------------
# Prep plans: same limits, refunds and job safety as analyses
# ---------------------------------------------------------------------------

def counted_plan_runs():
    return AnalysisRun.objects.filter(kind="prep_plan", refunded=False).count()


def make_plan(api, application, run_jobs=None):
    body = {"application": application.id, "interview_date": (timezone.localdate() + timedelta(days=5)).isoformat()}
    if run_jobs is None:  # leave the generation job queued
        return api.post("/api/prep-plans/", body, format="json")
    with run_jobs():
        return api.post("/api/prep-plans/", body, format="json")


def test_free_plan_gets_one_prep_plan_then_none_is_created(api, application, run_jobs):
    assert make_plan(api, application, run_jobs).status_code == 201

    res = make_plan(api, application, run_jobs)
    assert res.status_code == 429
    assert "1 prep plans" in res.data["detail"]
    assert res.data["code"] == "usage_limit" and res.data["feature"] == "ai_prep_plan"
    assert res.data["limit"] == 1 and res.data["used"] == 1 and res.data["reset_at"]
    assert PrepPlan.objects.count() == 1  # no empty plan left behind


def test_regenerate_counts_and_is_limited(api, application, run_jobs, settings):
    settings.PLAN_PREP_PLANS_PER_24H = {**settings.PLAN_PREP_PLANS_PER_24H, "free": 2}
    plan = make_plan(api, application, run_jobs).data
    assert PrepPlan.objects.get(id=plan["id"]).status == JobStatus.DONE
    with run_jobs():
        assert api.post(f"/api/prep-plans/{plan['id']}/regenerate/").status_code == 202
    assert api.post(f"/api/prep-plans/{plan['id']}/regenerate/").status_code == 429
    assert counted_plan_runs() == 2


def test_analyses_and_prep_plans_are_counted_separately(api, application, run_jobs):
    log_round(api, application, run_jobs, "Q1")
    log_round(api, application, run_jobs, "Q2")  # analyses used up
    assert make_plan(api, application, run_jobs).status_code == 201
    usage = api.get("/api/auth/me/").data["usage"]
    assert usage["analyses"]["remaining"] == 0 and usage["prep_plans"]["used"] == 1


def test_regenerate_while_generating_is_rejected(api, application):
    plan = make_plan(api, application).data
    assert plan["status"] == "pending"
    assert api.post(f"/api/prep-plans/{plan['id']}/regenerate/").status_code == 409
    assert counted_plan_runs() == 1


def test_unbilled_plan_failure_is_given_back(api, application, run_jobs, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(httpx.ConnectError("down", request=_REQ))):
        plan = make_plan(api, application, run_jobs).data
    plan = PrepPlan.objects.get(id=plan["id"])
    assert plan.status == JobStatus.FAILED and plan.refunded is True
    assert counted_plan_runs() == 0


def test_plan_refusal_counts(api, application, run_jobs, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(finish_reason="SAFETY"))):
        plan = make_plan(api, application, run_jobs).data
    assert PrepPlan.objects.get(id=plan["id"]).refunded is False
    assert counted_plan_runs() == 1


def test_replaced_queued_plan_job_never_runs(api, application):
    plan_id = make_plan(api, application).data["id"]
    old_run = AnalysisRun.objects.get(kind="prep_plan")
    AnalysisRun.objects.filter(id=old_run.id).update(created_at=timezone.now() - timedelta(minutes=20))
    assert api.post(f"/api/prep-plans/{plan_id}/regenerate/").status_code == 202

    with mock.patch.object(ai, "generate_plan") as generate:
        generate_plan_task(plan_id, old_run.id)
    generate.assert_not_called()
    assert AnalysisRun.objects.get(id=old_run.id).refunded  # never billed: given back
    assert PrepPlan.objects.get(id=plan_id).status == JobStatus.PENDING


def test_plan_job_queued_by_older_deploy_still_runs(api, application):
    plan_id = make_plan(api, application).data["id"]
    PrepPlan.objects.filter(id=plan_id).update(run=None)
    generate_plan_task(plan_id)
    assert PrepPlan.objects.get(id=plan_id).status == JobStatus.DONE


def test_no_retry_sleeps_inside_the_web_request(api, application, run_jobs, with_ai, settings):
    # No broker: the job runs inside the request, so it fails fast instead of sleeping there.
    settings.AI_RETRY_DELAYS = ()
    client, calls = _sequence_client(_overloaded(), _reply())
    with mock.patch.object(ai, "get_client", return_value=client), mock.patch.object(ai.time, "sleep") as sleep:
        log_round(api, application, run_jobs)
    assert len(calls) == 1
    sleep.assert_not_called()
    assert counted_runs() == 0  # unbilled: given back


# ---------------------------------------------------------------------------
# No API key: the free rule-based jobs aren't limited
# ---------------------------------------------------------------------------

def test_no_api_key_means_no_limits(api, application, run_jobs, settings):
    settings.GEMINI_API_KEY = ""
    for i in range(3):
        assert not log_round(api, application, run_jobs, f"Q{i}").data["analysis_limited"]
    for _ in range(3):
        assert make_plan(api, application, run_jobs).status_code == 201

    usage = api.get("/api/auth/me/").data["usage"]
    assert usage["analyses"]["limit"] is None and usage["prep_plans"]["limit"] is None
    assert usage["ai_enabled"] is False
    assert AnalysisRun.objects.filter(free=False).count() == 0  # recorded, but never counted


def test_free_runs_dont_count_once_a_key_is_added(api, application, run_jobs, settings):
    settings.GEMINI_API_KEY = ""
    log_round(api, application, run_jobs, "Q1")
    log_round(api, application, run_jobs, "Q2")
    settings.GEMINI_API_KEY = "test-key"
    assert api.get("/api/auth/me/").data["usage"]["analyses"]["remaining"] == 2


def test_no_api_key_still_blocks_double_starts(api, application, settings):
    settings.GEMINI_API_KEY = ""
    round_id = _round_with_queued_analysis(api, application)
    assert api.post(f"/api/rounds/{round_id}/analyze/").status_code == 409


# ---------------------------------------------------------------------------
# Cut-offs per kind, free decided at run time, older rule-based runs
# ---------------------------------------------------------------------------

def test_cut_off_analysis_counts_and_mentions_the_debrief(api, application, run_jobs, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(finish_reason="MAX_TOKENS"))):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert "shortening your debrief" in analysis.error
    assert analysis.refunded is False and counted_runs() == 1


def test_cut_off_plan_is_a_capped_refund(api, application, run_jobs, with_ai):
    # A plan's input is mostly ours, so a cut-off isn't the user's doing.
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(finish_reason="MAX_TOKENS"))):
        plan = make_plan(api, application, run_jobs).data
    plan = PrepPlan.objects.get(id=plan["id"])
    assert "debrief" not in plan.error and "too long" in plan.error
    assert plan.refunded is True
    assert AnalysisRun.objects.get(kind="prep_plan").billed is True  # counts towards the refund cap


def test_key_added_while_queued_counts(api, application, settings):
    settings.GEMINI_API_KEY = ""
    round_id = _round_with_queued_analysis(api, application)
    assert AnalysisRun.objects.get().free is True

    settings.GEMINI_API_KEY = "test-key"  # the job then makes a paid call
    analyze_round_task(round_id, AnalysisRun.objects.get().id)
    assert AnalysisRun.objects.get().free is False
    assert counted_runs() == 1


def test_key_removed_while_queued_is_free(api, application, settings):
    round_id = _round_with_queued_analysis(api, application)
    settings.GEMINI_API_KEY = ""  # the job then runs the free rule-based analyzer
    analyze_round_task(round_id, AnalysisRun.objects.get().id)
    assert AnalysisRun.objects.get().free is True


def test_migration_marks_older_rule_based_runs_free(api, application, run_jobs, settings):
    import importlib

    from django.apps import apps

    settings.GEMINI_API_KEY = ""
    log_round(api, application, run_jobs)          # rule-based analysis
    make_plan(api, application, run_jobs)          # rule-based plan
    AnalysisRun.objects.update(free=False)         # as recorded before the `free` field existed

    migration = importlib.import_module("tracker.migrations.0008_mark_rule_based_runs_free")
    migration.mark_rule_based_runs_free(apps, None)
    assert AnalysisRun.objects.filter(free=False).count() == 0


# ---------------------------------------------------------------------------
# Gemini replies and errors that need their own handling
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("finish_reason", ["RECITATION", "LANGUAGE", "OTHER"])
def test_unfinished_reply_is_a_plain_failure_with_a_clear_message(api, application, run_jobs, with_ai, finish_reason):
    # Partial text like '{"a"' must not reach json.loads, and isn't the user's doing.
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(finish_reason=finish_reason, text='{"a"'))):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED and analysis.refunded is True
    assert f"stopped before finishing its reply ({finish_reason})" in analysis.error


def test_prompt_blocked_for_no_content_reason_is_not_counted(api, application, run_jobs, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(block_reason="OTHER"))):
        res = log_round(api, application, run_jobs)
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.FAILED and analysis.refunded is True
    assert counted_runs() == 0


def test_unreadable_json_gets_a_readable_message(api, application, run_jobs, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_reply(text='{"summary": '))):
        res = log_round(api, application, run_jobs)
    assert RoundAnalysis.objects.get(round_id=res.data["id"]).error == "The AI's reply couldn't be read. Try again."


def test_daily_quota_is_not_retried_and_says_so(api, application, run_jobs, with_ai, settings):
    settings.AI_RETRY_DELAYS = (1, 3)
    client, calls = _sequence_client(_out_of_daily_quota(), _reply())
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert len(calls) == 1
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert "daily limit" in analysis.error and analysis.refunded is True


@pytest.mark.parametrize("vertex,expected", [(False, "free daily limit"), (True, "The AI's daily limit")])
def test_daily_limit_only_says_free_off_vertex(api, application, run_jobs, settings, vertex, expected):
    # Vertex is billed, so its daily quota isn't a "free" one
    settings.GEMINI_API_KEY, settings.VERTEX_API_KEY = ("", "vertex-key") if vertex else ("test-key", "")
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_out_of_daily_quota())):
        res = log_round(api, application, run_jobs)
    assert expected in RoundAnalysis.objects.get(round_id=res.data["id"]).error


@pytest.mark.parametrize("code,status", [(408, "REQUEST_TIMEOUT"), (413, "PAYLOAD_TOO_LARGE"), (422, "UNPROCESSABLE")])
def test_other_rejections_dont_say_busy(api, application, run_jobs, with_ai, settings, code, status):
    # Not retried, and waiting won't fix them, so "busy right now" would mislead
    settings.AI_RETRY_DELAYS = (1, 3)
    client, calls = _sequence_client(_api_error(code, status))
    with mock.patch.object(ai, "get_client", return_value=client):
        res = log_round(api, application, run_jobs)
    assert len(calls) == 1
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert "couldn't handle this request" in analysis.error and "busy" not in analysis.error
    assert analysis.refunded is True


def test_setup_mistakes_on_vertex_point_at_the_vertex_key(api, application, run_jobs, settings, caplog):
    settings.VERTEX_API_KEY = "vertex-key"
    with mock.patch.object(ai, "get_client", return_value=_fake_client(_api_error(404, "NOT_FOUND"))), \
            caplog.at_level("ERROR", logger="tracker.ai"):
        res = log_round(api, application, run_jobs)
    assert "isn't set up correctly" in RoundAnalysis.objects.get(round_id=res.data["id"]).error
    assert "VERTEX_API_KEY" in caplog.text and "GEMINI_PAID_API_KEY" not in caplog.text


@pytest.mark.parametrize("code,status", [(404, "NOT_FOUND"), (400, "INVALID_ARGUMENT"), (403, "PERMISSION_DENIED")])
def test_setup_mistakes_say_so_and_log_the_details(api, application, run_jobs, with_ai, settings, caplog, code, status):
    # Not "unavailable right now": that looks like an outage. The details are for the admin, in the log.
    settings.AI_RETRY_DELAYS = (1, 3)
    client, calls = _sequence_client(_api_error(code, status))
    with mock.patch.object(ai, "get_client", return_value=client), caplog.at_level("ERROR", logger="tracker.ai"):
        res = log_round(api, application, run_jobs)
    assert len(calls) == 1
    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert "isn't set up correctly" in analysis.error and "GEMINI" not in analysis.error
    assert analysis.refunded is True
    assert "GEMINI_MODEL" in caplog.text and str(code) in caplog.text


@pytest.mark.parametrize("message,expected", [
    ("User location is not supported for the API use.", "isn't available in the region"),
    ("The input token count exceeds the maximum number of tokens allowed.", "too long for the AI"),
    # A limit on the reply's own length is a setup mistake, not something the user can shorten.
    ("max_output_tokens exceeds the limit for this model.", "isn't set up correctly"),
])
def test_rejections_users_can_act_on_get_their_own_message(api, application, run_jobs, with_ai, caplog, message, expected):
    error = errors.ClientError(400, {"error": {"code": 400, "message": message, "status": "FAILED_PRECONDITION"}})
    with mock.patch.object(ai, "get_client", return_value=_fake_client(error)), caplog.at_level("ERROR", logger="tracker.ai"):
        res = log_round(api, application, run_jobs)
    assert expected in RoundAnalysis.objects.get(round_id=res.data["id"]).error
    assert message in caplog.text  # every rejection is logged for the admin


def test_usage_says_whether_the_key_is_on_the_free_tier(api, settings):
    assert api.get("/api/auth/me/").data["usage"]["ai_free_tier"] is True
    settings.GEMINI_FREE_TIER = False
    assert api.get("/api/auth/me/").data["usage"]["ai_free_tier"] is False
