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


def queue_analysis(rnd):
    """Mark the round's analysis as pending and run it after the transaction commits."""
    RoundAnalysis.objects.update_or_create(
        round=rnd, defaults={"status": JobStatus.PENDING, "error": ""}
    )
    queue(analyze_round_task, rnd.id)


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


class RoundListCreateView(RoundQuerysetMixin, generics.ListCreateAPIView):
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
        if serializer.debrief_saved:
            queue_analysis(rnd)


class RoundDetailView(RoundQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """GET, PUT, PATCH and DELETE a single round. Saving a debrief re-queues the analysis."""
    serializer_class = InterviewRoundSerializer
    permission_classes = [IsAuthenticated]

    def perform_update(self, serializer):
        rnd = serializer.save()
        if serializer.debrief_saved:
            queue_analysis(rnd)


class RoundAnalyzeView(APIView):
    """Re-runs the analysis for a round that has a debrief."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        rnd = get_object_or_404(InterviewRound, pk=pk, application__user=request.user)
        if not hasattr(rnd, "debrief"):
            return Response({"detail": "Write a debrief first."}, status=status.HTTP_400_BAD_REQUEST)
        queue_analysis(rnd)
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
