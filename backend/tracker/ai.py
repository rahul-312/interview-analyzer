"""
Round analysis and prep-plan generation.

Two layers:
1. A rule-based fallback that always works (no API key needed).
2. Gemini, used only when GEMINI_API_KEY is set. Structured output makes the reply
   JSON matching the schema.
"""
import json
import logging
import time

from django.conf import settings

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

TOPIC_ADVICE = {
    "system design": "Practise a fixed framework: requirements, estimates, API, data model, high-level design, "
                     "then deep-dive on bottlenecks. Do one timed design per day out loud.",
    "behavioral": "Write 6-8 STAR stories (situation, task, action, result) with numbers, and map each one to "
                  "common prompts like conflict, failure, ownership and leadership.",
    "behavioural": "Write 6-8 STAR stories (situation, task, action, result) with numbers, and map each one to "
                   "common prompts like conflict, failure, ownership and leadership.",
    "coding": "Solve 2-3 timed problems a day in this pattern. Talk through your approach before coding, "
              "and test edge cases out loud at the end.",
    "algorithm": "Review the core patterns (two pointers, sliding window, BFS/DFS, heaps, DP) and solve "
                 "timed problems, explaining complexity each time.",
    "sql": "Practise joins, GROUP BY with HAVING, window functions and subqueries on a sample schema. "
           "Explain the query plan for each one.",
    "python": "Review language fundamentals (data model, generators, comprehensions, typing) and write "
              "small programs without an IDE.",
    "database": "Review indexing, transactions and isolation levels, normalisation, and when to pick SQL vs NoSQL.",
}
DEFAULT_ADVICE = "Write a model answer for this topic, then practise saying it out loud in under two minutes."

ROUND_BASICS = {
    "phone_screen": ["Elevator pitch and why this company", "Résumé walk-through"],
    "technical": ["Core data structures and algorithms", "Coding under time pressure"],
    "system_design": ["System design framework", "Scaling: caching, queues, sharding"],
    "behavioral": ["STAR stories", "Questions to ask the interviewer"],
    "hiring_manager": ["Why this role and team", "Past impact with numbers"],
    "take_home": ["Clean project structure and tests", "Writing a clear README"],
    "onsite": ["Coding under time pressure", "STAR stories", "System design framework"],
    "other": ["Company research", "Résumé walk-through"],
}


def normalize_topic(topic):
    return " ".join((topic or "").lower().split()) or "general"


def advice_for(topic):
    t = normalize_topic(topic)
    for key, advice in TOPIC_ADVICE.items():
        if key in t:
            return advice
    return DEFAULT_ADVICE


def ai_enabled():
    return bool(settings.GEMINI_API_KEY)


# ---------------------------------------------------------------------------
# Layer 1: rule-based
# ---------------------------------------------------------------------------

def rule_based_analysis(context):
    debrief = context.get("debrief") or {}
    questions = debrief.get("questions") or []
    weaknesses, strengths, reviews, ratings = [], [], [], []

    for q in questions:
        conf = q.get("confidence")
        topic = q.get("topic") or "general"
        if conf is not None:
            ratings.append(conf)
        if conf is not None and conf <= 2:
            weaknesses.append({
                "topic": topic,
                "severity": "high" if conf == 1 else "medium",
                "evidence": f'You rated your answer to "{q["question"]}" {conf}/5.',
                "advice": advice_for(topic),
            })
            reviews.append({
                "question": q["question"],
                "verdict": "Weak: you weren't confident in this answer.",
                "better_answer": "Add an API key to get a suggested stronger answer.",
            })
        elif conf is not None and conf >= 4:
            strengths.append(f'Confident answer on {topic}: "{q["question"]}"')
            reviews.append({"question": q["question"], "verdict": "Strong.", "better_answer": ""})

    if debrief.get("went_well"):
        strengths.append(debrief["went_well"])

    went_badly = (debrief.get("went_badly") or "").strip()
    if went_badly:
        if weaknesses:
            worst = min(weaknesses, key=lambda w: {"high": 0, "medium": 1, "low": 2}[w["severity"]])
            worst["evidence"] += f" You also noted: {went_badly}"
        else:
            weaknesses.append({
                "topic": "general",
                "severity": "low",
                "evidence": f"You noted: {went_badly}",
                "advice": DEFAULT_ADVICE,
            })

    if ratings:
        score = round(sum(ratings) / len(ratings) * 20)
    elif debrief.get("overall_feeling"):
        score = debrief["overall_feeling"] * 20
    else:
        score = 50

    summary = (
        f"Rule-based review of {len(questions)} question(s). "
        f"{len(weaknesses)} weak spot(s) and {len(strengths)} strength(s) found from your confidence ratings."
    )
    return {
        "summary": summary,
        "score": score,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "answer_reviews": reviews,
    }


def rule_based_plan(context):
    days = max(1, context["days"])
    topics = [w["topic"] for w in context.get("weak_spots", [])]
    for basic in ROUND_BASICS.get(context.get("round_type") or "other", ROUND_BASICS["other"]):
        if normalize_topic(basic) not in {normalize_topic(t) for t in topics}:
            topics.append(basic)

    tasks = []
    study_days = max(1, days - 1) if days > 1 else 1
    for day in range(1, study_days + 1):
        topic = topics[(day - 1) % len(topics)]
        tasks.append({
            "day": day,
            "topic": topic,
            "title": f"Practise: {topic}",
            "detail": advice_for(topic),
            "minutes": 60,
        })
    if days > 1:
        tasks.append({
            "day": days,
            "topic": "review",
            "title": "Light review and mock run-through",
            "detail": "Skim your notes, do one short mock interview, and get a good night's sleep.",
            "minutes": 45,
        })

    weak = ", ".join(w["topic"] for w in context.get("weak_spots", [])[:3])
    summary = f"{days}-day plan for {context['role']} at {context['company']}."
    if weak:
        summary += f" Focuses first on your weak spots: {weak}."
    return {"summary": summary, "tasks": tasks}


# ---------------------------------------------------------------------------
# Layer 2: Gemini
# ---------------------------------------------------------------------------

ANALYSIS_SYSTEM = """You are an experienced interview coach reviewing a candidate's own debrief of a job interview round.
Be specific and honest. Base every point on what the debrief actually says; don't invent events.
For each weakness, quote or paraphrase the evidence from the debrief and give concrete, actionable advice.
For each question in the debrief, give a short verdict and, when the answer was weak, a stronger model answer.
Score the round from 0 to 100 for how well it likely went.
Use short, normalised topic names (for example "system design", "sql", "behavioral", "dynamic programming") so topics can be grouped across rounds."""

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "score": {"type": "integer"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "evidence": {"type": "string"},
                    "advice": {"type": "string"},
                },
                "required": ["topic", "severity", "evidence", "advice"],
                "additionalProperties": False,
            },
        },
        "answer_reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "verdict": {"type": "string"},
                    "better_answer": {"type": "string"},
                },
                "required": ["question", "verdict", "better_answer"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "score", "strengths", "weaknesses", "answer_reviews"],
    "additionalProperties": False,
}

PLAN_SYSTEM = """You are an interview coach building a day-by-day prep plan.
Prioritise the candidate's recurring weak spots first, then the fundamentals for the round type and the job description.
Put one main topic on each day, with a concrete task the candidate can finish in the given minutes.
Day numbers start at 1 and must not exceed the number of days available. The final day is always light review and a mock run-through."""

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "day": {"type": "integer"},
                    "topic": {"type": "string"},
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "minutes": {"type": "integer"},
                },
                "required": ["day", "topic", "title", "detail", "minutes"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "tasks"],
    "additionalProperties": False,
}


class NotCharged(Exception):
    """Every attempt failed before a billed response came back (network error, 4xx/429/5xx, overloaded)."""


class UserCaused(Exception):
    """A billed failure the user's own text can cause, so it counts against their limit."""


class Refused(UserCaused):
    """The model declined the content."""


class CutOff(UserCaused):
    """
    The reply hit max_tokens. For an analysis, long or open-ended debrief text can cause this on
    purpose, so it counts. generate_plan turns it into an ordinary (refundable) failure instead.
    """


class Billing:
    """
    Tracks whether a paid API request was sent. Callers use it to decide refunds by *where*
    a failure happened: once `api_called` is set, any failure counts unless it is NotCharged.
    """

    def __init__(self):
        self.api_called = False



# Generous, since there's a lot to write; a reply that arrives after this is lost but may still have
# used up a request from the daily quota.
TIMEOUT_SECONDS = 300

# Why Gemini blocked content: the reply (finish reasons) or the prompt itself (block reasons). Only
# these count against the user; anything else that stops a reply is our side's or Gemini's problem.
BLOCKED = {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"}
BLOCKED_PROMPT = {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "JAILBREAK"}

# Rejections that mean the server is set up wrong (bad key, unknown model, a schema Gemini won't
# take), not that Gemini is down, so they say so instead of "try again".
SETUP_ERRORS = {400, 401, 403, 404}

logger = logging.getLogger(__name__)


def _name(value):
    """An SDK enum's plain name ("RECITATION"), or the value as it is."""
    return getattr(value, "value", value)


def _out_of_daily_quota(exc):
    """A 429 for the day's free-tier quota (as opposed to the per-minute one, which a retry can get past)."""
    return exc.code == 429 and "PerDay" in json.dumps(getattr(exc, "details", None), default=str)


def _http_errors(name):
    """The `name` exception class from httpx and from httpx2: the SDK uses whichever is installed."""
    import importlib.util

    return tuple(
        getattr(importlib.import_module(lib), name) for lib in ("httpx", "httpx2") if importlib.util.find_spec(lib)
    )


def get_client():
    from google import genai
    from google.genai import types

    # No hidden SDK retries: a retry after a (possibly counted) timeout must not look "not charged".
    return genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options=types.HttpOptions(
            timeout=TIMEOUT_SECONDS * 1000,  # milliseconds
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )


def call_gemini(system, prompt, schema, billing=None):
    from google.genai import errors, types

    billing = billing or Billing()
    client = get_client()
    timeouts = _http_errors("TimeoutException")
    # Network failures other than timeouts (connect, read, protocol errors).
    connection_errors = _http_errors("TransportError")
    # Unbilled failures are retried after these delays (none without a broker); never after a timeout.
    delays = settings.AI_RETRY_DELAYS
    for attempt in range(len(delays) + 1):
        billing.api_called = True  # from here on, an unexpected failure may have been billed
        try:
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    max_output_tokens=16000,
                    response_mime_type="application/json",
                    response_json_schema=schema,
                ),
            )
            break
        except timeouts as exc:
            # The server may have finished (and counted it) after we stopped waiting: don't retry, it counts.
            raise RuntimeError("The AI took too long to respond. Try again.") from exc
        except (errors.APIError, *connection_errors) as exc:
            # Network failure, or the API rejected/failed the request (4xx, 429 quota, 5xx): nothing billed.
            if isinstance(exc, errors.APIError) and _out_of_daily_quota(exc):
                raise NotCharged("The AI's free daily limit has been reached. Try again tomorrow.") from exc
            if isinstance(exc, errors.APIError) and exc.code in SETUP_ERRORS:
                logger.error("Gemini rejected the request (check GEMINI_API_KEY and GEMINI_MODEL): %s", exc)
                raise NotCharged(
                    f"The AI isn't set up correctly on the server (Gemini said: {exc.code} {exc.status}). "
                    "Check GEMINI_API_KEY and GEMINI_MODEL."
                ) from exc
            retryable = not isinstance(exc, errors.APIError) or exc.code == 429 or exc.code >= 500
            if retryable and attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise NotCharged(f"The AI service is unavailable right now ({exc.__class__.__name__}). Try again.") from exc

    feedback = response.prompt_feedback
    if feedback and feedback.block_reason:
        if _name(feedback.block_reason) in BLOCKED_PROMPT:
            raise Refused("The AI declined to analyse this content.")
        raise RuntimeError(f"The AI didn't answer ({_name(feedback.block_reason)}). Try again.")
    candidate = response.candidates[0] if response.candidates else None
    finish = _name(candidate.finish_reason) if candidate else None
    if finish in BLOCKED:
        raise Refused("The AI declined to analyse this content.")
    if finish == "MAX_TOKENS":
        raise CutOff("The AI response was too long and got cut off.")
    if finish != "STOP":
        # RECITATION, LANGUAGE, OTHER…: what came back is only part of a reply.
        raise RuntimeError(f"The AI stopped before finishing its reply ({finish or 'no reply'}). Try again.")
    try:
        return json.loads(response.text or "")
    except json.JSONDecodeError as exc:
        raise RuntimeError("The AI's reply couldn't be read. Try again.") from exc


def _context_block(context):
    return json.dumps(context, indent=2, default=str)


def analyze_round(context, billing=None):
    """Returns (result, "ai") or (result, "rules")."""
    if not ai_enabled():
        return rule_based_analysis(context), "rules"
    prompt = (
        "Analyse this interview round. The candidate's debrief and the job context are below as JSON.\n\n"
        f"<round>\n{_context_block(context)}\n</round>"
    )
    try:
        result = call_gemini(ANALYSIS_SYSTEM, prompt, ANALYSIS_SCHEMA, billing)
    except CutOff as exc:
        raise CutOff("The analysis came out too long and got cut off. Try shortening your debrief.") from exc
    result["score"] = max(0, min(100, int(result["score"])))
    return result, "ai"


def generate_plan(context, billing=None):
    """Returns (result, "ai") or (result, "rules")."""
    if not ai_enabled():
        return rule_based_plan(context), "rules"
    prompt = (
        f"Build a {context['days']}-day prep plan. The candidate's context and recurring weak spots are below as JSON.\n\n"
        f"<context>\n{_context_block(context)}\n</context>"
    )
    try:
        result = call_gemini(PLAN_SYSTEM, prompt, PLAN_SCHEMA, billing)
    except CutOff as exc:
        # A plan's input is mostly ours (weak spots, round type, up to 14 days), and thinking counts
        # towards max_tokens, so a cut-off isn't the user's doing: a plain failure, refunded within the cap.
        raise RuntimeError("The plan came out too long and got cut off. Try again.") from exc
    days = max(1, context["days"])
    for task in result["tasks"]:
        task["day"] = max(1, min(days, int(task["day"])))
        task["minutes"] = max(5, min(480, int(task["minutes"])))
    return result, "ai"
