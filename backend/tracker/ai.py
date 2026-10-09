"""
Round analysis and prep-plan generation.

Two layers:
1. A rule-based fallback that always works (no API key needed).
2. Claude, used only when ANTHROPIC_API_KEY is set. Structured output guarantees
   the reply is valid JSON matching the schema.
"""
import json
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
    return bool(settings.ANTHROPIC_API_KEY)


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
# Layer 2: Claude
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


class Refused(Exception):
    """The model declined the content. Caused by what the user wrote, so it counts."""


class Billing:
    """
    Tracks whether a paid API request was sent. Callers use it to decide refunds by *where*
    a failure happened: once `api_called` is set, any failure counts unless it is NotCharged.
    """

    def __init__(self):
        self.api_called = False


# Failures where the API sent nothing billable back. Retried here, never after a timeout.
RETRY_DELAYS = (1, 3)


def get_client():
    import anthropic

    # No hidden SDK retries: a retry after a (possibly billed) timeout must not look "not charged".
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=0)


def call_claude(system, prompt, schema, billing=None):
    import anthropic

    billing = billing or Billing()
    client = get_client()
    for attempt in range(len(RETRY_DELAYS) + 1):
        billing.api_called = True  # from here on, an unexpected failure may have been billed
        try:
            response = client.beta.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            break
        except anthropic.APITimeoutError as exc:
            # The server may have finished (and billed) after we stopped waiting: don't retry, it counts.
            raise RuntimeError("The AI took too long to respond. Try again.") from exc
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            # Network failure, or the API rejected/failed the request (4xx, 429, 5xx, overloaded): nothing billed.
            retryable = isinstance(exc, anthropic.APIConnectionError) or exc.status_code == 429 or exc.status_code >= 500
            if retryable and attempt < len(RETRY_DELAYS):
                time.sleep(RETRY_DELAYS[attempt])
                continue
            raise NotCharged(f"The AI service is unavailable right now ({exc.__class__.__name__}). Try again.") from exc

    if response.stop_reason == "refusal":
        raise Refused("The AI declined to analyse this content.")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The AI response was cut off. Try again.")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


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
    result = call_claude(ANALYSIS_SYSTEM, prompt, ANALYSIS_SCHEMA, billing)
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
    result = call_claude(PLAN_SYSTEM, prompt, PLAN_SCHEMA, billing)
    days = max(1, context["days"])
    for task in result["tasks"]:
        task["day"] = max(1, min(days, int(task["day"])))
        task["minutes"] = max(5, min(480, int(task["minutes"])))
    return result, "ai"
