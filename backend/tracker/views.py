import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing import entitlements, tiers

from . import ai, insights
from .models import Application, InterviewRound, JobStatus, PrepPlan, PrepTask, RoundAnalysis
from .serializers import (
    ApplicationSerializer,
    InterviewRoundSerializer,
    PrepPlanSerializer,
    PrepTaskSerializer,
)
from .tasks import analyze_round_task, generate_plan_task, queue
from .usage import (
    BUSY,
    LIMITED,
    PREP_PLAN,
    QUEUED,
    VOICE,
    limit_details,
    limit_message,
    mark_stale,
    refund_run,
    reserve_analysis,
    reserve_prep_plan,
    reserve_voice,
)

logger = logging.getLogger(__name__)


def queue_analysis(rnd, user):
    """
    Starts an analysis of the round if the user's plan allows it, and runs it after the
    transaction commits. Returns QUEUED, LIMITED (no analyses left) or BUSY (already running).
    """
    result, run = reserve_analysis(user, rnd)
    if result == QUEUED:
        queue(analyze_round_task, rnd.id, run.id, priority=run.priority)
    return result


def queue_plan(plan, user):
    """
    Starts generating the plan if the user's plan allows it, and runs it after the transaction
    commits. Returns QUEUED, LIMITED (no prep plans left) or BUSY (already generating).
    """
    result, run = reserve_prep_plan(user, plan)
    if result == QUEUED:
        queue(generate_plan_task, plan.id, run.id, priority=run.priority)
    return result


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

class ApplicationQuerysetMixin:
    """Limits every query to the logged-in user's applications."""
    def get_queryset(self):
        return Application.objects.filter(user=self.request.user).prefetch_related("rounds")


class ApplicationListCreateView(ApplicationQuerysetMixin, generics.ListCreateAPIView):
    """
    GET: list the user's applications (supports ?status=, ?search= and ?job_url=, an exact match).
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
        # The browser extension uses this to tell whether a job was already saved.
        if params.get("job_url"):
            qs = qs.filter(job_url=params["job_url"])
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ApplicationLookupView(APIView):
    """
    POST {"job_urls": [...]}: which of these job links the user has saved, as {"matches": {url: id}}.
    The browser extension asks once per page of job cards, so its "Saved" marks follow the app.
    """
    permission_classes = [IsAuthenticated]
    MAX_URLS = 100

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response({"job_urls": ["Send a JSON object with a list of links."]}, status=status.HTTP_400_BAD_REQUEST)
        urls = request.data.get("job_urls")
        if not isinstance(urls, list) or not all(isinstance(u, str) for u in urls):
            return Response({"job_urls": ["Send a list of links."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(urls) > self.MAX_URLS:
            return Response({"job_urls": [f"Send at most {self.MAX_URLS} links."]}, status=status.HTTP_400_BAD_REQUEST)
        found = Application.objects.filter(user=request.user, job_url__in=[u for u in urls if u])
        return Response({"matches": dict(found.values_list("job_url", "id"))})


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
            return Response(limit_details(request.user), status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response({"detail": "Analysis queued."}, status=status.HTTP_202_ACCEPTED)


# Room for the multipart boundaries and headers around the recording itself.
MULTIPART_OVERHEAD = 64 * 1024


class DebriefFromVoiceView(APIView):
    """
    Turns a spoken recap (multipart field `audio`) into a draft debrief for the form. Nothing is
    saved; the user checks the draft and saves the round as usual. Needs AI on the user's plan,
    and counts against the plan's voice-debrief limit unless it fails for a reason that isn't
    theirs. The AI call runs inside the request, with a short timeout and no retry waits.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        too_long = Response(
            {"detail": "That recording is too large to send. Try a shorter one."},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )
        no_ai = Response(
            {"detail": "Filling a debrief by voice needs AI, which isn't on for your plan."},
            status=status.HTTP_403_FORBIDDEN,
        )
        # Before touching request.FILES, which would read (and write to disk) the whole body first.
        # A body without a length (chunked) can't be checked up front, so it isn't accepted.
        try:
            length = int(request.META.get("CONTENT_LENGTH") or "")
        except ValueError:
            return Response(
                {"detail": "Send the recording with a Content-Length."}, status=status.HTTP_411_LENGTH_REQUIRED
            )
        if length > settings.VOICE_DEBRIEF_MAX_BYTES + MULTIPART_OVERHEAD:
            return too_long

        if entitlements.ai_route(entitlements.for_user(request.user)) is None:
            return no_ai
        audio = request.FILES.get("audio")
        if audio is None or audio.size == 0:
            return Response({"detail": "Send a recording as `audio`."}, status=status.HTTP_400_BAD_REQUEST)
        if audio.size > settings.VOICE_DEBRIEF_MAX_BYTES:
            return too_long
        data = audio.read()
        mime_type = ai.sniff_audio(data[:16])
        if mime_type is None:
            return Response(
                {"detail": "That doesn't look like an audio recording. Try recording again."},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )

        result, run = reserve_voice(request.user)
        if result == LIMITED:
            return Response(limit_details(request.user, VOICE), status=status.HTTP_429_TOO_MANY_REQUESTS)
        # The key and model for the plan the run was counted against, so the two can't differ.
        route = entitlements.ai_route(tiers.get_tier(run.tier))
        if route is None:
            refund_run(run.id, billed=False)
            return no_ai

        try:
            draft = ai.debrief_from_audio(data, mime_type, route)
        except ai.UserCaused as exc:
            # Refused or cut off because of what was said: counts, like an analysis would.
            return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        except ai.UnreadableAudio as exc:
            refund_run(run.id, billed=False)
            return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        except ai.NotCharged as exc:
            refund_run(run.id, billed=False)
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except RuntimeError as exc:
            # Timed out or an unreadable reply: may have been billed, so given back within the cap.
            refund_run(run.id, billed=True)
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        except BaseException:
            # Our own bug, or the worker being stopped (gunicorn's timeout exits through SystemExit):
            # not the user's doing, so given back within the cap. A failed refund (say, the database
            # is down) is logged, and the original error is the one that propagates.
            try:
                refund_run(run.id, billed=True)
            except Exception:
                logger.exception("Couldn't give back voice debrief run %s", run.id)
            raise
        if not draft["questions"] and not any(
            draft[k] for k in ("went_well", "went_badly", "interviewer_cues", "recruiter_feedback")
        ):
            # Usually a muted mic or the wrong input device: given back within the cap, so a few
            # silent recordings can't use up a small daily allowance.
            refunded = refund_run(run.id, billed=True)
            note = "" if refunded else " This one still counted towards your daily voice debriefs."
            return Response(
                {"detail": "Couldn't make out a debrief in that recording. Check your microphone and "
                           "try again, a little closer to it." + note},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return Response(draft)


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

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            plan = serializer.save(user=request.user)
            if queue_plan(plan, request.user) == LIMITED:
                details = limit_details(request.user, PREP_PLAN)
                # At the limit: don't keep an empty plan that can never be generated.
                transaction.set_rollback(True)
                return Response(details, status=status.HTTP_429_TOO_MANY_REQUESTS)
        plan = self.get_queryset().get(pk=plan.pk)
        return Response(self.get_serializer(plan).data, status=status.HTTP_201_CREATED)


class PrepPlanDetailView(PrepPlanQuerysetMixin, generics.RetrieveDestroyAPIView):
    """GET and DELETE a single plan. Plans aren't edited, only regenerated."""
    serializer_class = PrepPlanSerializer
    permission_classes = [IsAuthenticated]


class PrepPlanRegenerateView(APIView):
    """Throws away the plan's tasks and generates new ones. Counts against the prep-plan limit."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        plan = get_object_or_404(PrepPlan, pk=pk, user=request.user)
        result = queue_plan(plan, request.user)
        if result == BUSY:
            return Response({"detail": "This plan is already being generated."}, status=status.HTTP_409_CONFLICT)
        if result == LIMITED:
            return Response(limit_details(request.user, PREP_PLAN), status=status.HTTP_429_TOO_MANY_REQUESTS)
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
            # Whether this user's plan gets Gemini, as usage() reports it.
            "ai_enabled": entitlements.ai_route(entitlements.for_user(user)) is not None,
        })
