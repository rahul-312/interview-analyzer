import json
from types import SimpleNamespace
from unittest import mock

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.throttling import ScopedRateThrottle

from tracker import ai

pytestmark = pytest.mark.django_db

URL = "/api/rounds/debrief-from-voice/"


def _client(body, finish_reason="STOP", calls=None):
    def generate_content(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        return SimpleNamespace(
            prompt_feedback=None,
            candidates=[SimpleNamespace(finish_reason=finish_reason)],
            text=json.dumps(body),
        )

    return SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))


def _audio(content=b"fake-opus-bytes", content_type="audio/webm;codecs=opus"):
    return SimpleUploadedFile("debrief.webm", content, content_type=content_type)


REPLY = {
    "questions": [
        {"question": "Design a URL shortener", "answer": "Hash plus base62, Redis cache",
         "topic": "System  Design", "confidence": 4},
        {"question": "  ", "answer": "", "topic": "", "confidence": 0},
    ],
    "went_well": "I explained the trade-offs clearly.",
    "went_badly": "",
    "interviewer_cues": "They pushed on cache invalidation.",
    "recruiter_feedback": "",
    "overall_feeling": 9,
}


@pytest.fixture(autouse=True)
def fresh_throttle():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def with_ai(settings):
    settings.GEMINI_API_KEY = "test-key"


def test_voice_fills_a_draft_debrief(api, with_ai):
    calls = []
    with mock.patch.object(ai, "get_client", return_value=_client(REPLY, calls=calls)):
        res = api.post(URL, {"audio": _audio()}, format="multipart")
    assert res.status_code == 200, res.data
    assert res.data["questions"] == [{
        "question": "Design a URL shortener", "answer": "Hash plus base62, Redis cache",
        "topic": "system design", "confidence": 4,
    }]
    assert res.data["went_well"] == "I explained the trade-offs clearly."
    assert res.data["overall_feeling"] is None  # out of range
    # The audio went to Gemini as inline data, with the codecs parameter dropped.
    part = calls[0]["contents"][0]
    assert part.inline_data.mime_type == "audio/webm"
    assert part.inline_data.data == b"fake-opus-bytes"


def test_voice_needs_ai_on_the_plan(api):
    res = api.post(URL, {"audio": _audio()}, format="multipart")
    assert res.status_code == 403


def test_voice_rejects_missing_or_wrong_audio(api, with_ai):
    assert api.post(URL, {}, format="multipart").status_code == 400
    res = api.post(URL, {"audio": _audio(content_type="text/plain")}, format="multipart")
    assert res.status_code == 415


def test_voice_rejects_long_recordings(api, with_ai, settings):
    settings.VOICE_DEBRIEF_MAX_BYTES = 10
    res = api.post(URL, {"audio": _audio(b"x" * 11)}, format="multipart")
    assert res.status_code == 413


def test_voice_with_nothing_usable_says_so(api, with_ai):
    empty = {k: "" for k in ("went_well", "went_badly", "interviewer_cues", "recruiter_feedback")}
    empty.update(questions=[], overall_feeling=0)
    with mock.patch.object(ai, "get_client", return_value=_client(empty)):
        res = api.post(URL, {"audio": _audio()}, format="multipart")
    assert res.status_code == 422


def test_voice_refusal_is_reported(api, with_ai):
    with mock.patch.object(ai, "get_client", return_value=_client(REPLY, finish_reason="SAFETY")):
        res = api.post(URL, {"audio": _audio()}, format="multipart")
    assert res.status_code == 422
    assert "declined" in res.data["detail"]


def test_voice_is_rate_limited(api, with_ai):
    # THROTTLE_RATES is read from settings when DRF loads, so patch the class attribute.
    with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"voice_debrief": "2/day"}), \
            mock.patch.object(ai, "get_client", return_value=_client(REPLY)):
        codes = [api.post(URL, {"audio": _audio()}, format="multipart").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
