from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import ai, insights
from .models import Application, InterviewRound, JobStatus, PrepPlan, PrepTask, RoundAnalysis
from .serializers import (
    ApplicationSerializer,
    InterviewRoundSerializer,
    PrepPlanSerializer,
    PrepTaskSerializer,
)
from .tasks import analyze_round_task, generate_plan_task, queue
from .usage import BUSY, LIMITED, QUEUED, limit_message, mark_stale, reserve_analysis


def queue_analysis(rnd, user):
    """
    Starts an analysis of the round if the user's plan allows it, and runs it after the
    transaction commits. Returns QUEUED, LIMITED (no analyses left) or BUSY (already running).
    """
    result, run = reserve_analysis(user, rnd)
    if result == QUEUED:
        queue(analyze_round_task, rnd.id, run.id)
    return result


def queue_plan(plan):
    plan.status = JobStatus.PENDING
    plan.error = ""
    plan.save(update_fields=["status", "error"])
    queue(generate_plan_task, plan.id)


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

class ApplicationQuerysetMixin:
    """Limits every query to the logged-in user's applications."""
    def get_queryset(self):
        return Application.objects.filter(user=self.request.user).prefetch_related("rounds")


class ApplicationListCreateView(ApplicationQuerysetMixin, generics.ListCreateAPIView):
    """
    GET: list the user's applications (supports ?status= and ?search=).
    POST: create an application. Only company, role and date_applied are required.
    """
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("search"):
            qs = qs.filter(Q(company__icontains=params["search"]) | Q(role__icontains=params["search"]))
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ApplicationDetailView(ApplicationQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """GET, PUT, PATCH and DELETE a single application."""
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated]


# ---------------------------------------------------------------------------
# Interview rounds
# ---------------------------------------------------------------------------

class RoundQuerysetMixin:
    """Limits every query to rounds on the logged-in user's applications."""
    def get_queryset(self):
        return InterviewRound.objects.filter(application__user=self.request.user).select_related(
            "application", "debrief", "analysis"
        )


class AnalysisLimitMixin:
    """
    Queues an analysis after a debrief is saved, within the user's daily limit.
    At the limit the round and debrief are still saved; the response says
    `analysis_limited: true` with a message, and the analysis can be run later.
    """
    analysis_limited = False

    def queue_if_debrief_saved(self, serializer, rnd):
        if not serializer.debrief_saved:
            return
        result = queue_analysis(rnd, self.request.user)
        if result == LIMITED:
            self.analysis_limited = True
            mark_stale(rnd)
        # BUSY: an analysis is already queued or running. A queued one reads the new debrief when it
        # starts; a running one notices the debrief changed and saves its result as out of date.
        # Re-read so the response shows the new analysis status, not a cached one.
        serializer.instance = self.get_queryset().get(pk=rnd.pk)

    def add_limit_info(self, response):
        response.data["analysis_limited"] = self.analysis_limited
        if self.analysis_limited:
            response.data["analysis_limit_message"] = limit_message(self.request.user)
        return response


class RoundListCreateView(RoundQuerysetMixin, AnalysisLimitMixin, generics.ListCreateAPIView):
    """
    GET: list the user's rounds (supports ?application=).
    POST: log a round. Send `debrief` to save one and queue an analysis.
    """
    serializer_class = InterviewRoundSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        application = self.request.query_params.get("application")
        if application:
            qs = qs.filter(application_id=application)
        return qs

    def perform_create(self, serializer):
        rnd = serializer.save()
        self.queue_if_debrief_saved(serializer, rnd)

    def create(self, request, *args, **kwargs):
        return self.add_limit_info(super().create(request, *args, **kwargs))


class RoundDetailView(RoundQuerysetMixin, AnalysisLimitMixin, generics.RetrieveUpdateDestroyAPIView):
    """GET, PUT, PATCH and DELETE a single round. A changed debrief re-queues the analysis."""
    serializer_class = InterviewRoundSerializer
    permission_classes = [IsAuthenticated]

    def perform_update(self, serializer):
        rnd = serializer.save()
        self.queue_if_debrief_saved(serializer, rnd)

    def update(self, request, *args, **kwargs):
        return self.add_limit_info(super().update(request, *args, **kwargs))


class RoundAnalyzeView(APIView):
    """Runs (or re-runs) the analysis for a round that has a debrief. Counts against the daily limit."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        rnd = get_object_or_404(InterviewRound, pk=pk, application__user=request.user)
        if not hasattr(rnd, "debrief"):
            return Response({"detail": "Write a debrief first."}, status=status.HTTP_400_BAD_REQUEST)
        result = queue_analysis(rnd, request.user)
        if result == BUSY:
            return Response({"detail": "This round is already being analysed."}, status=status.HTTP_409_CONFLICT)
        if result == LIMITED:
            return Response({"detail": limit_message(request.user)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response({"detail": "Analysis queued."}, status=status.HTTP_202_ACCEPTED)


# ---------------------------------------------------------------------------
# Prep plans
# ---------------------------------------------------------------------------

class PrepPlanQuerysetMixin:
    def get_queryset(self):
        return PrepPlan.objects.filter(user=self.request.user).select_related(
            "application", "target_round"
        ).prefetch_related("tasks")


class PrepPlanListCreateView(PrepPlanQuerysetMixin, generics.ListCreateAPIView):
    """
    GET: list the user's prep plans.
    POST: create a plan for an application (and optionally a target round) and queue generation.
    """
    serializer_class = PrepPlanSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        plan = serializer.save(user=self.request.user)
        queue(generate_plan_task, plan.id)


class PrepPlanDetailView(PrepPlanQuerysetMixin, generics.RetrieveDestroyAPIView):
    """GET and DELETE a single plan. Plans aren't edited, only regenerated."""
    serializer_class = PrepPlanSerializer
    permission_classes = [IsAuthenticated]


class PrepPlanRegenerateView(APIView):
    """Throws away the plan's tasks and generates new ones."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        plan = get_object_or_404(PrepPlan, pk=pk, user=request.user)
        queue_plan(plan)
        return Response({"detail": "Plan regeneration queued."}, status=status.HTTP_202_ACCEPTED)


class PrepTaskDetailView(generics.UpdateAPIView):
    """PUT or PATCH a task. Only `done` is writable."""
    serializer_class = PrepTaskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return PrepTask.objects.filter(plan__user=self.request.user)


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

class InsightsView(APIView):
    """Weak spots, pass rates by round type, and the application funnel."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "weak_spots": insights.weak_spots(user),
            "round_outcomes": insights.round_outcomes(user),
            "funnel": insights.funnel(user),
            "analysed_rounds": RoundAnalysis.objects.filter(
                round__application__user=user, status=JobStatus.DONE
            ).count(),
            "ai_enabled": ai.ai_enabled(),
        })
