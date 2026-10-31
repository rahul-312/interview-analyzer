from datetime import date

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from tracker.models import Application


@pytest.fixture(autouse=True)
def offline_settings(settings):
    """No real API calls and no broker: rule-based analyzer, tasks run inline. Nothing from the developer's .env."""
    settings.GEMINI_API_KEY = ""
    settings.GEMINI_PAID_API_KEY = ""
    settings.GEMINI_FREE_TIER = True
    settings.CELERY_TASK_ALWAYS_EAGER = True
    from config.celery import app
    app.conf.task_always_eager = True


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", password="a-strong-pass-123")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(username="bob", password="a-strong-pass-123")


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def application(user):
    return Application.objects.create(user=user, company="Acme", role="Backend Engineer", date_applied=date(2026, 9, 1))


@pytest.fixture
def run_jobs(django_capture_on_commit_callbacks):
    """Runs queued background jobs (they're scheduled with transaction.on_commit)."""
    return lambda: django_capture_on_commit_callbacks(execute=True)
