from django.urls import path

from .views import (
    CancelView,
    ChangePlanView,
    CheckoutView,
    CurrentSubscriptionView,
    PaymentsView,
    PlansView,
    RazorpayWebhookView,
    ResumeView,
    UsageView,
    VerifyView,
)

urlpatterns = [
    path("subscriptions/plans/", PlansView.as_view()),
    path("subscriptions/current/", CurrentSubscriptionView.as_view()),
    path("subscriptions/usage/", UsageView.as_view()),
    path("subscriptions/payments/", PaymentsView.as_view()),
    path("subscriptions/checkout/", CheckoutView.as_view()),
    path("subscriptions/verify/", VerifyView.as_view()),
    path("subscriptions/change-plan/", ChangePlanView.as_view()),
    path("subscriptions/cancel/", CancelView.as_view()),
    path("subscriptions/resume/", ResumeView.as_view()),
    path("webhooks/razorpay/", RazorpayWebhookView.as_view()),
]
