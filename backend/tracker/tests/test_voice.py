import json
from types import SimpleNamespace
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from google.genai import errors

from tracker import ai
from tracker.models import AnalysisRun

pytestmark = pytest.mark.django_db

URL = "/api/rounds/debrief-from-voice/"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 60  # a WebM (EBML) header, then anything


def _client(body=None, finish_reason="STOP", calls=None, raises=None):
    def generate_content(**kwargs):
        if calls is not None:
            calls.append(kwargs)
        if raises:
            raise raises
        return SimpleNamespace(
            prompt_feedback=None,
            candidates=[SimpleNamespace(finish_reason=finish_reason)],
            text=json.dumps(body),
        )

    return SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))


def _audio(content=WEBM, content_type="audio/webm;codecs=opus"):
    return SimpleUploadedFile("debrief.webm", content, content_type=content_type)


def _post(api, **extra):
    return api.post(URL, {"audio": extra.pop("audio", None) or _audio()}, format="multipart", **extra)


def _client_error(code, message):
    return errors.ClientError(code, {"error": {"code": code, "message": message, "status": "INVALID_ARGUMENT"}})


def counted():
    return AnalysisRun.objects.filter(kind=AnalysisRun.Kind.VOICE, refunded=False).count()


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


@pytest.fixture
def with_ai(settings):
    settings.GEMINI_API_KEY = "test-key"


@pytest.fixture
def gemini(with_ai):
    """Patches the Gemini client; call it with _client's arguments."""
    patches = []

    def use(*args, **kwargs):
        patcher = mock.patch.object(ai, "get_client", return_value=_client(*args, **kwargs))
        patcher.start()
        patches.append(patcher)

    yield use
    for p in patches:
        p.stop()


def test_voice_fills_a_draft_debrief(api, gemini):
    calls = []
    gemini(REPLY, calls=calls)
    res = _post(api, audio=_audio(content_type="application/octet-stream"))
    assert res.status_code == 200, res.data
    assert res.data["questions"] == [{
        "question": "Design a URL shortener", "answer": "Hash plus base62, Redis cache",
        "topic": "system design", "confidence": 4,
    }]
    assert res.data["went_well"] == "I explained the trade-offs clearly."
    assert res.data["overall_feeling"] is None  # out of range
    # The audio went to Gemini inline, typed by its bytes rather than by what the client claimed.
    part = calls[0]["contents"][0]
    assert part.inline_data.mime_type == "audio/webm"
    assert part.inline_data.data == WEBM
    assert counted() == 1


def test_voice_call_has_a_short_timeout_and_no_retries(api, with_ai, settings):
    settings.AI_RETRY_DELAYS = (1, 3)
    settings.VOICE_DEBRIEF_TIMEOUT_SECONDS = 25
    with mock.patch.object(ai, "get_client", return_value=_client(raises=errors.ServerError(
        503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}},
    ))) as get_client, mock.patch.object(ai.time, "sleep") as sleep:
        res = _post(api)
    assert res.status_code == 503
    assert get_client.call_args.args[2] == 25
    sleep.assert_not_called()


def test_voice_needs_ai_on_the_plan(api):
    assert _post(api).status_code == 403


def test_voice_rejects_missing_audio(api, with_ai):
    assert api.post(URL, {}, format="multipart").status_code == 400


def test_voice_checks_the_bytes_not_the_claimed_type(api, with_ai):
    res = _post(api, audio=_audio(b"not audio at all", content_type="audio/webm"))
    assert res.status_code == 415
    assert counted() == 0


@pytest.mark.parametrize("head, mime", [
    (b"\x1a\x45\xdf\xa3....", "audio/webm"),
    (b"OggS\x00\x02", "audio/ogg"),
    (b"\x00\x00\x00\x20ftypM4A ", "audio/mp4"),
    (b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/wav"),
    (b"FORM\x00\x00\x00\x00AIFF", "audio/aiff"),
    (b"fLaC\x00\x00", "audio/flac"),
    (b"ID3\x04\x00", "audio/mpeg"),
    (b"\xff\xfb\x90\x00", "audio/mpeg"),
    (b"\xff\xf1\x50\x80", "audio/aac"),
    (b"\x00\x00\x00\x18ftypheic", None),
    (b"\x00\x00\x00\x1cftypavif", None),
    (b"<html>", None),
    (b"", None),
])
def test_sniff_audio(head, mime):
    assert ai.sniff_audio(head) == mime


def test_voice_rejects_a_large_body_before_reading_it(api, with_ai, settings):
    settings.VOICE_DEBRIEF_MAX_BYTES = 1000
    with mock.patch("rest_framework.request.Request.FILES", new_callable=mock.PropertyMock) as files:
        res = _post(api, CONTENT_LENGTH=str(10_000_000))
    assert res.status_code == 413
    files.assert_not_called()


def test_voice_rejects_a_large_file(api, with_ai, settings):
    settings.VOICE_DEBRIEF_MAX_BYTES = 10
    assert _post(api, audio=_audio(WEBM)).status_code == 413
    assert counted() == 0


def test_voice_counts_against_the_plan_limit(api, gemini, settings):
    settings.PLAN_VOICE_DEBRIEFS_PER_24H = {**settings.PLAN_VOICE_DEBRIEFS_PER_24H, "free": 2}
    gemini(REPLY)
    codes = [_post(api).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    res = _post(api)
    assert res.data["code"] == "usage_limit" and res.data["feature"] == "ai_voice_debrief"
    quota = api.get("/api/auth/me/").data["usage"]["voice_debriefs"]
    assert quota["limit"] == 2 and quota["remaining"] == 0


def test_voice_and_analysis_limits_are_separate(api, gemini, settings):
    settings.PLAN_VOICE_DEBRIEFS_PER_24H = {**settings.PLAN_VOICE_DEBRIEFS_PER_24H, "free": 1}
    gemini(REPLY)
    assert _post(api).status_code == 200
    usage = api.get("/api/auth/me/").data["usage"]
    assert usage["voice_debriefs"]["used"] == 1
    assert usage["analyses"]["used"] == 0


def test_voice_failures_that_cost_nothing_are_given_back(api, gemini):
    gemini(raises=errors.ServerError(503, {"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}}))
    assert _post(api).status_code == 503
    assert counted() == 0


def test_voice_format_gemini_cannot_read_is_reported_and_given_back(api, gemini):
    gemini(raises=_client_error(400, "Unsupported MIME type: audio/webm"))
    res = _post(api)
    assert res.status_code == 422
    assert "couldn't read that recording" in res.data["detail"]
    assert counted() == 0


def test_voice_bad_key_is_still_a_setup_error(api, gemini):
    gemini(raises=_client_error(400, "API key not valid. Please pass a valid API key."))
    res = _post(api)
    assert res.status_code == 503
    assert "set up correctly" in res.data["detail"]


def test_voice_refusal_counts(api, gemini):
    gemini(REPLY, finish_reason="SAFETY")
    res = _post(api)
    assert res.status_code == 422
    assert "declined" in res.data["detail"]
    assert counted() == 1


@pytest.mark.parametrize("reply", [
    ["not", "an", "object"],
    {**REPLY, "questions": ["just a string"]},
], ids=["list", "question-not-an-object"])
def test_voice_malformed_reply_is_a_502_not_a_500(api, gemini, reply):
    gemini(reply)
    res = _post(api)
    assert res.status_code == 502
    assert counted() == 0  # billed, but given back within the cap


EMPTY = {
    "questions": [], "went_well": "", "went_badly": "", "interviewer_cues": "", "recruiter_feedback": "",
    "overall_feeling": 0,
}


def test_voice_with_nothing_usable_says_so_and_is_given_back(api, gemini):
    gemini(EMPTY)
    res = _post(api)
    assert res.status_code == 422
    assert "still counted" not in res.data["detail"]
    assert counted() == 0


def test_voice_with_nothing_usable_says_when_it_counted(api, gemini, settings):
    settings.BILLED_REFUNDS_PER_24H = 0
    gemini(EMPTY)
    res = _post(api)
    assert "still counted" in res.data["detail"]
    assert counted() == 1


def test_voice_needs_a_content_length(api, with_ai):
    res = _post(api, CONTENT_LENGTH="")
    assert res.status_code == 411


def test_voice_unexpected_error_is_given_back(with_ai, user):
    from rest_framework.test import APIClient

    client = APIClient(raise_request_exception=False)
    client.force_authenticate(user)
    with mock.patch.object(ai, "debrief_from_audio", side_effect=KeyError("bug")):
        res = _post(client)
    assert res.status_code == 500
    assert counted() == 0


def test_voice_killed_worker_is_given_back(api, with_ai):
    # gunicorn's worker timeout exits the worker through SystemExit, which isn't an Exception.
    with mock.patch.object(ai, "debrief_from_audio", side_effect=SystemExit(1)), pytest.raises(SystemExit):
        _post(api)
    assert counted() == 0


def test_voice_failed_refund_keeps_the_original_error(api, with_ai):
    with mock.patch.object(ai, "debrief_from_audio", side_effect=KeyError("the real bug")), \
            mock.patch("tracker.views.refund_run", side_effect=RuntimeError("database down")), \
            pytest.raises(KeyError, match="the real bug"):
        _post(api)


def test_voice_uses_the_plan_it_was_counted_against(api, gemini):
    from billing import entitlements

    gemini(REPLY)
    with mock.patch.object(entitlements, "ai_route", wraps=entitlements.ai_route) as route:
        assert _post(api).status_code == 200
    # The last lookup, whose key and model the call uses, is for the tier the run was counted on.
    assert route.call_args_list[-1].args[0].code == AnalysisRun.objects.get().tier
