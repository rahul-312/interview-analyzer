from django.contrib import admin

from .models import AnalysisRun, Application, Debrief, InterviewRound, PrepPlan, PrepTask, RoundAnalysis


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ["company", "role", "status", "date_applied", "user"]
    list_filter = ["status", "source"]
    search_fields = ["company", "role"]


@admin.register(InterviewRound)
class InterviewRoundAdmin(admin.ModelAdmin):
    list_display = ["application", "round_type", "scheduled_at", "outcome"]
    list_filter = ["round_type", "outcome"]


@admin.register(RoundAnalysis)
class RoundAnalysisAdmin(admin.ModelAdmin):
    list_display = ["round", "status", "source", "score"]


class PrepTaskInline(admin.TabularInline):
    model = PrepTask
    extra = 0


@admin.register(PrepPlan)
class PrepPlanAdmin(admin.ModelAdmin):
    list_display = ["application", "interview_date", "status", "source"]
    inlines = [PrepTaskInline]


@admin.register(AnalysisRun)
class AnalysisRunAdmin(admin.ModelAdmin):
    list_display = ["user", "round", "created_at"]
    list_select_related = ["user", "round__application"]
    search_fields = ["user__username", "user__email"]
    raw_id_fields = ["user", "round"]
    date_hierarchy = "created_at"


admin.site.register(Debrief)
admin.site.register(PrepTask)
