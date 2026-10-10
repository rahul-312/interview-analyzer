from collections import Counter, defaultdict

from .ai import normalize_topic
from .models import Application, InterviewRound, JobStatus, RoundAnalysis

SEVERITY_SCORE = {"low": 1, "medium": 2, "high": 3}

# Statuses that imply the application reached at least this stage.
STAGES = ["applied", "screening", "interview", "offer"]
REACHED = {
    "applied": set(Application.Status.values) - {"saved"},
    "screening": {"screening", "interview", "offer"},
    "interview": {"interview", "offer"},
    "offer": {"offer"},
}


def weak_spots(user):
    """Weaknesses across all analysed rounds, grouped by topic, worst first."""
    analyses = (
        RoundAnalysis.objects.filter(round__application__user=user, status=JobStatus.DONE)
        .select_related("round__application")
        .order_by("updated_at")
    )
    groups = defaultdict(lambda: {"topic": "", "score": 0, "count": 0, "high_count": 0,
                                  "latest_advice": "", "rounds": []})
    for analysis in analyses:
        rnd = analysis.round
        for w in analysis.weaknesses or []:
            key = normalize_topic(w.get("topic"))
            g = groups[key]
            g["topic"] = key
            g["score"] += SEVERITY_SCORE.get(w.get("severity"), 1)
            g["count"] += 1
            g["high_count"] += w.get("severity") == "high"
            g["latest_advice"] = w.get("advice") or g["latest_advice"]
            if not any(r["id"] == rnd.id for r in g["rounds"]):
                g["rounds"].append({
                    "id": rnd.id,
                    "company": rnd.application.company,
                    "round_type": rnd.get_round_type_display(),
                    "date": rnd.scheduled_at.date().isoformat(),
                })
    return sorted(groups.values(), key=lambda g: (-g["score"], -g["count"], g["topic"]))


def round_outcomes(user):
    """Pass/fail counts and pass rate per round type."""
    rows = {}
    for rnd in InterviewRound.objects.filter(application__user=user):
        row = rows.setdefault(rnd.round_type, {
            "round_type": rnd.round_type,
            "label": rnd.get_round_type_display(),
            "passed": 0, "failed": 0, "pending": 0,
        })
        row[rnd.outcome] += 1

    result = []
    for row in rows.values():
        decided = row["passed"] + row["failed"]
        row["pass_rate"] = round(row["passed"] / decided * 100) if decided else None
        result.append(row)
    result.sort(key=lambda r: r["label"])

    decided_rows = [r for r in result if r["pass_rate"] is not None]
    weakest = min(decided_rows, key=lambda r: r["pass_rate"]) if decided_rows else None
    return {"by_type": result, "weakest": weakest["label"] if weakest else None}


def funnel(user):
    """How many applications reached each stage, plus by-source and status counts. Saved jobs aren't applications yet."""
    apps = list(Application.objects.filter(user=user).exclude(status=Application.Status.SAVED).values("status", "source"))
    stages, prev = [], None
    for stage in STAGES:
        count = sum(1 for a in apps if a["status"] in REACHED[stage])
        conversion = round(count / prev * 100) if prev else None
        stages.append({"stage": stage, "label": Application.Status(stage).label, "count": count,
                       "conversion": conversion if stage != "applied" else None})
        prev = count

    by_source = defaultdict(lambda: {"total": 0, "interviews": 0, "offers": 0})
    for a in apps:
        key = a["source"] or "unknown"
        by_source[key]["total"] += 1
        by_source[key]["interviews"] += a["status"] in REACHED["interview"]
        by_source[key]["offers"] += a["status"] == "offer"
    labels = dict(Application.Source.choices)
    sources = [{"source": k, "label": labels.get(k, "Not set"), **v} for k, v in by_source.items()]
    sources.sort(key=lambda s: -s["total"])

    return {
        "stages": stages,
        "by_source": sources,
        "status_counts": dict(Counter(a["status"] for a in apps)),
        "total": len(apps),
    }
