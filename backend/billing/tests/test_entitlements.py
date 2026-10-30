import json
import threading
from datetime import date, timedelta
from types import SimpleNamespace
from unittest import mock

import pytest
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Profile
from billing import entitlements, tiers
from billing.models import SubscriptionPlan, SubscriptionStatus, UserSubscription
from billing.training import training_eligible_debriefs
from tracker import ai, usage
from tracker.models import AnalysisRun, Application, Debrief, InterviewRound, RoundAnalysis
from tracker.tasks import analyze_round_task, generate_plan_task

pytestmark = pytest.mark.django_db


def give_subscription(user, tier, status=SubscriptionStatus.ACTIVE, **fields):
    plan = SubscriptionPlan.objects.get(tier=tier, interval="month")
    return UserSubscription.objects.create(
        user=user, plan=plan, interval="month", razorpay_subscription_id=f"sub_{user.id}_{tier}_{status}",
        status=status, current_end=fields.pop("current_end", timezone.now() + timedelta(days=20)), **fields,
    )


@pytest.fixture
def application(user):
    return Application.objects.create(user=user, company="Acme", role="Engineer", date_applied=date(2026, 9, 1))


@pytest.fixture
def calls(settings):
    """A fake Gemini client that records the key and model each job used."""
    seen = []

    def get_client(api_key=None):
        def generate_content(**kwargs):
            seen.append({"api_key": api_key, "model": kwargs["model"]})
            schema = kwargs["config"].response_json_schema
            if "tasks" in schema["properties"]:
                body = {"summary": "plan", "tasks": [{"day": 1, "topic": "sql", "title": "t", "detail": "d", "minutes": 30}]}
            else:
                body = {"summary": "ok", "score": 70, "strengths": [], "weaknesses": [], "answer_reviews": []}
            return SimpleNamespace(
                text=json.dumps(body), prompt_feedback=None,
                candidates=[SimpleNamespace(finish_reason="STOP")],
            )
        return SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))

    with mock.patch.object(ai, "get_client", side_effect=get_client):
        yield seen


def debrief_body():
    return {"questions": [{"question": "Design a cache", "answer": "...", "topic": "system design", "confidence": 2}]}


def log_round(api, application, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        res = api.post("/api/rounds/", {
            "application": application.id, "round_type": "technical",
            "scheduled_at": (timezone.now() - timedelta(days=1)).isoformat(), "debrief": debrief_body(),
        }, format="json")
    assert res.status_code == 201, res.data
    return res.data


# ---------------------------------------------------------------------------
# Limits, model and queue per plan
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("tier,analyses,plans", [("free", 2, 1), ("pro", 15, 5), ("pro_plus", 50, 15)])
def test_limits_follow_the_plan(api, user, settings, tier, analyses, plans):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_PAID_API_KEY = "paid-key"
    if tier != "free":
        give_subscription(user, tier)
    data = api.get("/api/subscriptions/usage/").data
    assert data["plan"] == tier
    assert data["analyses"]["limit"] == analyses and data["prep_plans"]["limit"] == plans
    assert data["analyses"]["fair_use"] is (tier == "pro_plus")


def test_pro_plus_runs_on_the_better_model_and_priority_queue(api, user, application, settings, calls, django_capture_on_commit_callbacks):
    settings.GEMINI_PAID_API_KEY = "paid-key"
    settings.GEMINI_MODEL = "flash-model"
    settings.GEMINI_PRO_MODEL = "pro-model"
    give_subscription(user, "pro_plus")
    with mock.patch.object(analyze_round_task, "apply_async", wraps=analyze_round_task.apply_async) as queued:
        log_round(api, application, django_capture_on_commit_callbacks)
    assert queued.call_args.kwargs["queue"] == settings.CELERY_PRIORITY_QUEUE
    assert calls == [{"api_key": "paid-key", "model": "pro-model"}]
    run = AnalysisRun.objects.get()
    assert (run.tier, run.model, run.priority) == ("pro_plus", "pro-model", True)


def test_pro_and_free_use_flash_on_the_normal_queue(api, user, application, settings, calls, django_capture_on_commit_callbacks):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_PAID_API_KEY = "paid-key"
    settings.GEMINI_MODEL = "flash-model"
    settings.GEMINI_PRO_MODEL = "pro-model"
    with mock.patch.object(analyze_round_task, "apply_async", wraps=analyze_round_task.apply_async) as queued:
        log_round(api, application, django_capture_on_commit_callbacks)  # free
        give_subscription(user, "pro")
        log_round(api, application, django_capture_on_commit_callbacks)  # pro
    assert all("queue" not in c.kwargs for c in queued.call_args_list)
    assert calls == [{"api_key": "free-key", "model": "flash-model"}, {"api_key": "paid-key", "model": "flash-model"}]


def test_prep_plans_follow_the_plan_too(api, user, application, settings, calls, django_capture_on_commit_callbacks):
    settings.GEMINI_PAID_API_KEY = "paid-key"
    settings.GEMINI_PRO_MODEL = "pro-model"
    give_subscription(user, "pro_plus")
    body = {"application": application.id, "interview_date": (timezone.localdate() + timedelta(days=5)).isoformat()}
    with mock.patch.object(generate_plan_task, "apply_async", wraps=generate_plan_task.apply_async) as queued:
        with django_capture_on_commit_callbacks(execute=True):
            assert api.post("/api/prep-plans/", body, format="json").status_code == 201
    assert queued.call_args.kwargs["queue"] == settings.CELERY_PRIORITY_QUEUE
    assert calls[0]["model"] == "pro-model"


def test_limit_response_says_what_was_limited(api, application, settings, calls, django_capture_on_commit_callbacks):
    settings.GEMINI_API_KEY = "free-key"
    rnd = log_round(api, application, django_capture_on_commit_callbacks)
    log_round(api, application, django_capture_on_commit_callbacks)
    res = api.post(f"/api/rounds/{rnd['id']}/analyze/")
    assert res.status_code == 429
    assert res.data["code"] == "usage_limit" and res.data["feature"] == "ai_round_analysis"
    assert (res.data["plan"], res.data["limit"], res.data["used"]) == ("free", 2, 2)
    assert res.data["reset_at"]


def test_extension_gets_the_same_limits_as_the_web_app(user, application, settings, calls, django_capture_on_commit_callbacks):
    # The extension signs in with a JWT, like the web app; check with a real token rather than force_authenticate.
    settings.GEMINI_API_KEY = "free-key"
    client = APIClient()
    token = client.post("/api/auth/token/", {"username": "alice", "password": "a-strong-pass-123"}, format="json").data["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    web = APIClient()
    web.force_authenticate(user)

    rnd = log_round(web, application, django_capture_on_commit_callbacks)
    log_round(client, application, django_capture_on_commit_callbacks)
    assert client.post(f"/api/rounds/{rnd['id']}/analyze/").status_code == 429
    assert web.post(f"/api/rounds/{rnd['id']}/analyze/").status_code == 429


def test_lapsed_subscription_falls_back_to_free_limits(api, user, settings):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_PAID_API_KEY = "paid-key"
    for status in (SubscriptionStatus.HALTED, SubscriptionStatus.CANCELLED, SubscriptionStatus.COMPLETED,
                   SubscriptionStatus.AUTHENTICATED, SubscriptionStatus.CREATED, SubscriptionStatus.EXPIRED):
        give_subscription(user, "pro_plus", status=status)
    assert entitlements.tier_for(user) == "free"
    assert api.get("/api/subscriptions/usage/").data["analyses"]["limit"] == 2


# ---------------------------------------------------------------------------
# Debriefs and training
# ---------------------------------------------------------------------------

def test_paid_debriefs_never_go_to_a_free_tier_key(api, user, application, settings, calls, django_capture_on_commit_callbacks):
    settings.GEMINI_API_KEY = "free-key"
    settings.GEMINI_FREE_TIER = True
    give_subscription(user, "pro")
    rnd = log_round(api, application, django_capture_on_commit_callbacks)
    assert calls == []  # no paid-tier key: the rule-based engine instead
    assert RoundAnalysis.objects.get(round_id=rnd["id"]).source == "rules"
    usage_data = api.get("/api/subscriptions/usage/").data
    assert usage_data["ai_free_tier"] is False and usage_data["training_notice"] is False


def test_free_users_are_told_their_debriefs_may_be_used(api, settings):
    settings.GEMINI_API_KEY = "free-key"
    data = api.get("/api/auth/me/").data["usage"]
    assert data["training_notice"] is True and data["ai_free_tier"] is True


def test_training_eligibility_follows_the_plan(api, user, other_user, application, settings, django_capture_on_commit_callbacks):
    free_round = log_round(api, application, django_capture_on_commit_callbacks)
    assert Debrief.objects.get(round_id=free_round["id"]).training_eligible is True

    sub = give_subscription(user, "pro")
    paid_round = log_round(api, application, django_capture_on_commit_callbacks)
    assert Debrief.objects.get(round_id=paid_round["id"]).training_eligible is False
    # On a paid plan now: none of this user's debriefs are used, even the one written on Free.
    assert not training_eligible_debriefs().exists()

    # Editing the Free-era debrief while paid makes it ineligible for good.
    api.patch(f"/api/rounds/{free_round['id']}/", {"debrief": {**debrief_body(), "went_well": "edited"}}, format="json")
    sub.status = SubscriptionStatus.CANCELLED
    sub.save()
    assert entitlements.tier_for(user) == "free"
    assert not training_eligible_debriefs().exists()
    assert "training_eligible" not in api.get(f"/api/rounds/{free_round['id']}/").data["debrief"]


def test_downgrade_doesnt_make_paid_debriefs_eligible(api, user, application, django_capture_on_commit_callbacks):
    sub = give_subscription(user, "pro")
    paid_round = log_round(api, application, django_capture_on_commit_callbacks)
    sub.status = SubscriptionStatus.CANCELLED
    sub.save()
    new_round = log_round(api, application, django_capture_on_commit_callbacks)
    assert list(training_eligible_debriefs().values_list("round_id", flat=True)) == [new_round["id"]]
    assert paid_round["id"] != new_round["id"]


def test_complimentary_plan_counts_as_paid_for_data_rules(user):
    Profile.objects.filter(user=user).update(plan="pro")
    assert entitlements.for_user(user).debriefs_may_train is False


def test_route_rules(settings):
    free, pro = tiers.get_tier("free"), tiers.get_tier("pro")
    settings.GEMINI_API_KEY, settings.GEMINI_PAID_API_KEY, settings.GEMINI_FREE_TIER = "", "", True
    assert entitlements.ai_route(free) is None and entitlements.ai_route(pro) is None
    settings.GEMINI_API_KEY = "k"
    assert entitlements.ai_route(free).provider_may_train is True
    assert entitlements.ai_route(pro) is None
    settings.GEMINI_FREE_TIER = False  # GEMINI_API_KEY is a paid key: fine for everyone
    assert entitlements.ai_route(pro).api_key == "k" and entitlements.ai_route(free).provider_may_train is False
    settings.GEMINI_API_KEY, settings.GEMINI_PAID_API_KEY = "", "paid"
    assert entitlements.ai_route(free).api_key == "paid"


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------

@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_concurrent_requests_cant_pass_the_limit(user, settings):
    settings.GEMINI_API_KEY = "free-key"
    app = Application.objects.create(user=user, company="Acme", role="Engineer", date_applied=date(2026, 9, 1))
    rounds = []
    for _ in range(6):
        rnd = InterviewRound.objects.create(application=app, round_type="technical", scheduled_at=timezone.now())
        Debrief.objects.create(round=rnd, questions=debrief_body()["questions"])
        rounds.append(rnd)

    barrier = threading.Barrier(len(rounds))
    results = []

    def start(rnd):
        try:
            barrier.wait()
            results.append(usage.reserve_analysis(user, rnd)[0])
        finally:
            connection.close()

    threads = [threading.Thread(target=start, args=(r,)) for r in rounds]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == sorted([usage.QUEUED] * 2 + [usage.LIMITED] * 4)
    assert AnalysisRun.objects.filter(user=user).count() == 2
