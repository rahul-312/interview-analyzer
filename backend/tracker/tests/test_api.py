import json
import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from django.utils import timezone

from tracker import ai
from tracker.models import Application, InterviewRound, JobStatus, PrepPlan, PrepTask, RoundAnalysis

pytestmark = pytest.mark.django_db


def past(days=3):
    return (timezone.now() - timedelta(days=days)).isoformat()


def future(days=5):
    return (timezone.now() + timedelta(days=days)).isoformat()


def debrief(*questions, went_badly=""):
    return {
        "questions": [
            {"question": q, "answer": "...", "topic": topic, "confidence": conf} for q, topic, conf in questions
        ],
        "went_well": "",
        "went_badly": went_badly,
        "overall_feeling": 3,
    }


def test_quick_add_needs_only_company_role_date(api):
    res = api.post("/api/applications/", {"company": "Globex", "role": "SRE", "date_applied": "2026-09-10"})
    assert res.status_code == 201, res.data
    assert res.data["status"] == "applied"
    assert res.data["rounds_count"] == 0

    res = api.post("/api/applications/", {"company": "Globex"})
    assert res.status_code == 400
    assert "role" in res.data


def test_list_filters(api, application):
    Application.objects.create(user=application.user, company="Initech", role="Data", date_applied=date.today(),
                               status="offer")
    assert len(api.get("/api/applications/").data) == 2
    assert [a["company"] for a in api.get("/api/applications/?status=offer").data] == ["Initech"]
    assert [a["company"] for a in api.get("/api/applications/?search=acm").data] == ["Acme"]


def test_find_application_by_job_url(api, application):
    url = "https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-5-years-091025012345"
    application.job_url = url
    application.save()

    assert [a["id"] for a in api.get("/api/applications/", {"job_url": url}).data] == [application.id]
    assert api.get("/api/applications/", {"job_url": url + "9"}).data == []


def test_lookup_many_job_urls(api, application, other_user):
    url = "https://www.naukri.com/job-listings-a-091025012345"
    application.job_url = url
    application.save()
    Application.objects.create(user=other_user, company="Theirs", role="x", date_applied=date.today(),
                               job_url="https://www.naukri.com/job-listings-b-091025099999")

    res = api.post("/api/applications/lookup/", {"job_urls": [url, "https://www.naukri.com/job-listings-b-091025099999", ""]},
                   format="json")
    assert res.data == {"matches": {url: application.id}}  # not other users' jobs
    assert api.post("/api/applications/lookup/", {"job_urls": "nope"}, format="json").status_code == 400
    assert api.post("/api/applications/lookup/", [url], format="json").status_code == 400  # not an object
    assert api.post("/api/applications/lookup/", {"job_urls": ["x"] * 101}, format="json").status_code == 400


def test_other_users_cannot_see_or_use_data(api, application, other_user):
    from rest_framework.test import APIClient

    other = APIClient()
    other.force_authenticate(other_user)
    assert other.get("/api/applications/").data == []
    assert other.get(f"/api/applications/{application.id}/").status_code == 404
    assert other.delete(f"/api/applications/{application.id}/").status_code == 404

    # Can't log a round or make a plan against someone else's application.
    res = other.post("/api/rounds/", {"application": application.id, "round_type": "technical",
                                      "scheduled_at": past()}, format="json")
    assert res.status_code == 400
    res = other.post("/api/prep-plans/", {"application": application.id, "interview_date": "2026-12-01"},
                     format="json")
    assert res.status_code == 400


def test_debrief_produces_analysis_and_advances_status(api, application, run_jobs):
    with run_jobs():
        res = api.post("/api/rounds/", {
            "application": application.id,
            "round_type": "technical",
            "scheduled_at": past(),
            "debrief": debrief(("Design a rate limiter", "system design", 1),
                               ("Reverse a linked list", "coding", 5),
                               went_badly="Ran out of time"),
        }, format="json")
    assert res.status_code == 201, res.data

    analysis = RoundAnalysis.objects.get(round_id=res.data["id"])
    assert analysis.status == JobStatus.DONE
    assert analysis.source == "rules"
    assert analysis.score == 60
    assert analysis.weaknesses[0]["topic"] == "system design"
    assert analysis.weaknesses[0]["severity"] == "high"
    assert "Ran out of time" in analysis.weaknesses[0]["evidence"]
    application.refresh_from_db()
    assert application.status == "interview"


def test_analyze_requires_debrief(api, application):
    rnd = InterviewRound.objects.create(application=application, round_type="technical", scheduled_at=timezone.now())
    assert api.post(f"/api/rounds/{rnd.id}/analyze/").status_code == 400


def test_same_topic_in_two_rounds_ranks_first(api, application, run_jobs):
    for questions in [
        [("Design Twitter", "System Design", 2), ("Tell me about a conflict", "behavioral", 2)],
        [("Design a URL shortener", "system  design", 1)],
    ]:
        with run_jobs():
            api.post("/api/rounds/", {"application": application.id, "round_type": "system_design",
                                      "scheduled_at": past(), "debrief": debrief(*questions)}, format="json")

    data = api.get("/api/insights/").data
    top = data["weak_spots"][0]
    assert top["topic"] == "system design"
    assert top["count"] == 2
    assert len(top["rounds"]) == 2
    assert data["analysed_rounds"] == 2
    assert data["ai_enabled"] is False


def test_funnel_and_pass_rates(api, user):
    for status, source in [("saved", "referral"), ("applied", "cold"), ("screening", "cold"), ("interview", "referral"),
                           ("offer", "referral")]:
        Application.objects.create(user=user, company=status, role="x", date_applied=date.today(),
                                   status=status, source=source)
    app = Application.objects.get(company="interview")
    InterviewRound.objects.create(application=app, round_type="technical", scheduled_at=timezone.now(), outcome="failed")
    InterviewRound.objects.create(application=app, round_type="behavioral", scheduled_at=timezone.now(), outcome="passed")

    data = api.get("/api/insights/").data
    counts = {s["stage"]: s["count"] for s in data["funnel"]["stages"]}
    assert counts == {"applied": 4, "screening": 3, "interview": 2, "offer": 1}
    referral = next(s for s in data["funnel"]["by_source"] if s["source"] == "referral")
    assert referral == {"source": "referral", "label": "Referral", "total": 2, "interviews": 2, "offers": 1}
    assert data["round_outcomes"]["weakest"] == "Technical"
    # The saved job isn't an application yet, so it's in none of the numbers.
    assert data["funnel"]["total"] == 4 and "saved" not in data["funnel"]["status_counts"]


def test_logging_a_round_moves_a_saved_job_forward(api, user, run_jobs):
    app = Application.objects.create(user=user, company="Acme", role="x", date_applied=date.today(), status="saved")
    with run_jobs():
        api.post("/api/rounds/", {"application": app.id, "round_type": "phone_screen", "scheduled_at": past()}, format="json")
    app.refresh_from_db()
    assert app.status == "screening"
    assert app.applied_at == date.today()


def test_applied_at_records_when_a_job_was_really_applied_to(api, user):
    old = date(2026, 9, 1)
    added = api.post("/api/applications/", {"company": "A", "role": "x", "date_applied": old, "status": "rejected"},
                     format="json").data
    assert added["applied_at"] == "2026-09-01"  # added after the fact: applied on its date

    saved = api.post("/api/applications/", {"company": "B", "role": "x", "date_applied": old, "status": "saved"},
                     format="json").data
    assert saved["applied_at"] is None
    applied = api.patch(f"/api/applications/{saved['id']}/", {"status": "applied"}, format="json").data
    assert applied["applied_at"] == applied["date_applied"] == date.today().isoformat()

    # Saved, then rejected without applying: never applied, so not in the funnel.
    skipped = api.post("/api/applications/", {"company": "C", "role": "x", "date_applied": old, "status": "saved"},
                       format="json").data
    assert api.patch(f"/api/applications/{skipped['id']}/", {"status": "withdrawn"}, format="json").data["applied_at"] is None
    funnel = api.get("/api/insights/").data["funnel"]
    assert funnel["total"] == 2 and "withdrawn" not in funnel["status_counts"]


def test_setting_a_job_back_to_saved_takes_it_out_of_the_funnel(api, user):
    # Picked Applied by mistake, then corrected to Saved.
    app = api.post("/api/applications/", {"company": "A", "role": "x", "date_applied": "2026-09-01", "status": "applied"},
                   format="json").data
    corrected = api.patch(f"/api/applications/{app['id']}/", {"status": "saved"}, format="json").data
    assert corrected["applied_at"] is None and corrected["saved_at"] == date.today().isoformat()
    funnel = api.get("/api/insights/").data["funnel"]
    assert funnel["total"] == 0 and funnel["status_counts"] == {}


def test_saved_at_keeps_the_date_a_job_was_saved(api, user):
    saved = api.post("/api/applications/", {"company": "B", "role": "x", "date_applied": "2026-09-01", "status": "saved"},
                     format="json").data
    assert saved["saved_at"] == "2026-09-01"
    applied = api.patch(f"/api/applications/{saved['id']}/", {"status": "interview"}, format="json").data
    assert applied["saved_at"] == "2026-09-01"
    assert applied["date_applied"] == applied["applied_at"] == date.today().isoformat()


def test_undoing_a_mistaken_saved_keeps_the_real_applied_date(api, user):
    app = api.post("/api/applications/", {"company": "A", "role": "x", "date_applied": "2026-09-01", "status": "applied"},
                   format="json").data
    saved = api.patch(f"/api/applications/{app['id']}/", {"status": "saved"}, format="json").data
    # Dated as saved today, not with the applied date.
    assert saved["date_applied"] == saved["saved_at"] == date.today().isoformat()
    assert saved["applied_at"] is None and "previous_applied_at" not in saved

    back = api.patch(f"/api/applications/{app['id']}/", {"status": "applied"}, format="json").data
    assert back["date_applied"] == back["applied_at"] == "2026-09-01"
    assert back["saved_at"] is None  # it was never really saved for later


def test_editing_a_mistakenly_saved_job_leaves_its_dates_alone(api, user):
    app = api.post("/api/applications/", {"company": "A", "role": "x", "date_applied": "2026-09-01", "status": "applied"},
                   format="json").data
    saved = api.patch(f"/api/applications/{app['id']}/", {"status": "saved"}, format="json").data
    edited = api.patch(f"/api/applications/{app['id']}/", {"notes": "call recruiter"}, format="json").data
    for field in ("status", "date_applied", "applied_at", "saved_at"):
        assert edited[field] == saved[field], field

    # The applied date is still there to restore once it leaves Saved.
    back = api.patch(f"/api/applications/{app['id']}/", {"status": "applied"}, format="json").data
    assert back["date_applied"] == back["applied_at"] == "2026-09-01"


def test_refreshing_keeps_the_remembered_status_current(user):
    app = Application.objects.create(user=user, company="A", role="x", date_applied=date(2026, 9, 1), status="applied")
    elsewhere = Application.objects.get(pk=app.pk)
    elsewhere.status = "saved"  # set to Saved by mistake, through another instance
    elsewhere.save()

    app.refresh_from_db()
    app.status = "applied"  # undoing it
    app.save()
    # Judged against the refreshed values (Saved, dated today), so the real date comes back. Against
    # the stale ones (Applied, Sep 1) the date would look edited and today would stick.
    assert app.date_applied == app.applied_at == date(2026, 9, 1)


def test_undoing_a_mistaken_saved_to_rejected_keeps_the_application(api, user):
    app = api.post("/api/applications/", {"company": "A", "role": "x", "date_applied": "2026-09-01", "status": "applied"},
                   format="json").data
    api.patch(f"/api/applications/{app['id']}/", {"status": "saved"}, format="json")
    rejected = api.patch(f"/api/applications/{app['id']}/", {"status": "rejected"}, format="json").data
    assert rejected["date_applied"] == rejected["applied_at"] == "2026-09-01"
    assert api.get("/api/insights/").data["funnel"]["total"] == 1


def test_saving_an_edit_does_not_query_the_old_values_again(api, user, django_assert_num_queries):
    app = Application.objects.create(user=user, company="A", role="x", date_applied=date(2026, 9, 1), status="saved")
    app = Application.objects.get(pk=app.pk)
    app.status = "applied"
    with django_assert_num_queries(1):  # just the UPDATE
        app.save()
    app.status = "saved"  # values remembered from that save, not the original load
    with django_assert_num_queries(1):
        app.save()
    assert app.previous_applied_at == date.today()


def test_today_is_the_users_day_not_the_servers(user):
    from django.test import RequestFactory
    from django.utils import timezone

    from config.middleware import ClientTimezoneMiddleware

    seen = []
    middleware = ClientTimezoneMiddleware(lambda request: seen.append(timezone.get_current_timezone_name()))
    middleware(RequestFactory().get("/", HTTP_X_TIMEZONE="Asia/Kolkata"))
    for bad in ["../../etc/passwd", "/etc/passwd", "Asia", "Asia/Kolkata\n", "x" * 500]:
        middleware(RequestFactory().get("/", HTTP_X_TIMEZONE=bad))  # not a zone: ignored, no error
    middleware(RequestFactory().get("/"))
    assert seen == ["Asia/Kolkata"] + ["UTC"] * 6
    assert timezone.get_current_timezone_name() == "UTC"  # nothing left active afterwards


def test_changing_a_saved_jobs_date_changes_its_saved_date(api, user):
    saved = api.post("/api/applications/", {"company": "B", "role": "x", "date_applied": "2026-09-01", "status": "saved"},
                     format="json").data
    moved = api.patch(f"/api/applications/{saved['id']}/", {"date_applied": "2026-08-28"}, format="json").data
    assert moved["date_applied"] == moved["saved_at"] == "2026-08-28"
    applied = api.patch(f"/api/applications/{saved['id']}/", {"status": "applied"}, format="json").data
    assert applied["saved_at"] == "2026-08-28"


def test_refresh_from_db_takes_fields_by_position_too(user):
    app = Application.objects.create(user=user, company="A", role="x", date_applied=date(2026, 9, 1), status="applied")
    Application.objects.filter(pk=app.pk).update(status="saved", date_applied=date(2026, 9, 5))
    app.date_applied = date(2026, 9, 9)  # unsaved local change
    app.refresh_from_db(None, ["status"])
    assert app._loaded == {"status": "saved", "date_applied": date(2026, 9, 1)}  # date not refreshed: kept as loaded


def test_moving_to_applied_keeps_a_date_changed_in_the_same_edit(api, user):
    saved = api.post("/api/applications/", {"company": "B", "role": "x", "date_applied": "2026-09-01", "status": "saved"},
                     format="json").data
    res = api.patch(f"/api/applications/{saved['id']}/", {"status": "applied", "date_applied": "2026-09-03"}, format="json")
    assert res.data["date_applied"] == res.data["applied_at"] == "2026-09-03"


def test_prep_plan_targets_weak_spots_and_ends_with_review(api, application, run_jobs):
    with run_jobs():
        api.post("/api/rounds/", {"application": application.id, "round_type": "technical", "scheduled_at": past(),
                                  "debrief": debrief(("Window functions", "SQL", 1))}, format="json")
    with run_jobs():
        rnd = api.post("/api/rounds/", {"application": application.id, "round_type": "system_design",
                                        "scheduled_at": future(5)}, format="json").data
    with run_jobs():
        res = api.post("/api/prep-plans/", {"application": application.id, "target_round": rnd["id"]}, format="json")
    assert res.status_code == 201, res.data

    plan = PrepPlan.objects.get(id=res.data["id"])
    assert plan.status == JobStatus.DONE
    tasks = list(plan.tasks.all())
    assert tasks[0].topic == "sql"
    assert tasks[-1].title == "Light review and mock run-through"
    assert tasks[-1].date == plan.interview_date - timedelta(days=1)

    # Ticking a task done is the only writable field.
    task = tasks[0]
    res = api.patch(f"/api/prep-tasks/{task.id}/", {"done": True, "title": "hacked"}, format="json")
    assert res.status_code == 200
    task.refresh_from_db()
    assert task.done is True and task.title != "hacked"


def test_prep_plan_needs_a_date(api, application):
    res = api.post("/api/prep-plans/", {"application": application.id}, format="json")
    assert res.status_code == 400
    assert "interview_date" in res.data


class _FakeAnthropic(BaseHTTPRequestHandler):
    requests = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append({"path": self.path, "body": body, "headers": dict(self.headers)})
        result = {
            "summary": "Solid coding, weak on design.",
            "score": 140,  # out of range on purpose: should be clamped
            "strengths": ["Clear communication"],
            "weaknesses": [{"topic": "system design", "severity": "high",
                            "evidence": "Rated 1/5", "advice": "Practise a framework"}],
            "answer_reviews": [],
        }
        payload = json.dumps({
            "id": "msg_test", "type": "message", "role": "assistant", "model": body["model"],
            "content": [{"type": "text", "text": json.dumps(result)}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def test_claude_request_shape_against_mock_server(settings, monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _FakeAnthropic)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("ANTHROPIC_BASE_URL", f"http://127.0.0.1:{server.server_port}")
        settings.ANTHROPIC_API_KEY = "sk-ant-test"
        result, source = ai.analyze_round({"company": "Acme", "debrief": {"questions": []}})
    finally:
        server.shutdown()

    assert source == "ai"
    assert result["score"] == 100
    req = _FakeAnthropic.requests[-1]
    assert req["body"]["model"] == settings.ANTHROPIC_MODEL
    assert req["body"]["output_config"]["format"]["type"] == "json_schema"
    assert req["body"]["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in req["headers"].get("anthropic-beta", "")
