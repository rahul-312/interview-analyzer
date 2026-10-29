from django.db import migrations


def mark_rule_based_runs_free(apps, schema_editor):
    """
    Runs recorded before `free` existed default to counted. Mark the ones whose analysis or plan
    came from the free rule-based fallback, so they don't count once an API key is added.
    """
    AnalysisRun = apps.get_model("tracker", "AnalysisRun")
    RoundAnalysis = apps.get_model("tracker", "RoundAnalysis")
    PrepPlan = apps.get_model("tracker", "PrepPlan")

    rule_based_rounds = RoundAnalysis.objects.filter(source="rules").values("round_id")
    rule_based_plans = PrepPlan.objects.filter(source="rules").values("id")
    AnalysisRun.objects.filter(free=False, kind="analysis", round_id__in=rule_based_rounds).update(free=True)
    AnalysisRun.objects.filter(free=False, kind="prep_plan", prep_plan_id__in=rule_based_plans).update(free=True)


class Migration(migrations.Migration):
    dependencies = [("tracker", "0007_analysisrun_free")]

    operations = [migrations.RunPython(mark_rule_based_runs_free, migrations.RunPython.noop)]
