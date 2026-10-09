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
    for status, source in [("applied", "cold"), ("screening", "cold"), ("interview", "referral"), ("offer", "referral")]:
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
