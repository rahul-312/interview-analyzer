from django.urls import path

from .views import (
    ApplicationDetailView,
    ApplicationListCreateView,
    InsightsView,
    PrepPlanDetailView,
    PrepPlanListCreateView,
    PrepPlanRegenerateView,
    PrepTaskDetailView,
    RoundAnalyzeView,
    RoundDetailView,
    RoundListCreateView,
)

urlpatterns = [
    path("applications/", ApplicationListCreateView.as_view()),
    path("applications/<int:pk>/", ApplicationDetailView.as_view()),
    path("rounds/", RoundListCreateView.as_view()),
    path("rounds/<int:pk>/", RoundDetailView.as_view()),
    path("rounds/<int:pk>/analyze/", RoundAnalyzeView.as_view()),
    path("prep-plans/", PrepPlanListCreateView.as_view()),
    path("prep-plans/<int:pk>/", PrepPlanDetailView.as_view()),
    path("prep-plans/<int:pk>/regenerate/", PrepPlanRegenerateView.as_view()),
    path("prep-tasks/<int:pk>/", PrepTaskDetailView.as_view()),
    path("insights/", InsightsView.as_view()),
]
