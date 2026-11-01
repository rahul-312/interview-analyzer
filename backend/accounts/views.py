import math

from rest_framework import generics
from rest_framework.exceptions import ErrorDetail, Throttled
from rest_framework.permissions import AllowAny, IsAuthenticated

from .serializers import RegisterSerializer, UserSerializer
from .throttles import SignupAttemptThrottle, SignupThrottle


class RegisterView(generics.CreateAPIView):
    """POST: create a new account. Throttled per IP: every account gets free AI runs on a billed key."""
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_classes = [SignupAttemptThrottle]

    def perform_create(self, serializer):
        # The tight limit counts only accounts created, so a mistyped form doesn't use one up
        throttle = SignupThrottle()
        if not throttle.allow_request(self.request, self):
            self.throttled(self.request, throttle.wait())
        serializer.save()

    def throttled(self, request, wait):
        minutes = max(1, math.ceil((wait or 60) / 60))
        hours = math.ceil(minutes / 60)
        if minutes == 1:
            when = "a minute"
        elif minutes < 60:
            when = f"{minutes} minutes"
        else:
            when = "an hour" if hours == 1 else f"{hours} hours"
        exc = Throttled(wait)  # keeps the Retry-After header
        exc.detail = ErrorDetail(f"Too many sign-ups from this network. Try again in {when}.", code="throttled")
        raise exc


class MeView(generics.RetrieveUpdateAPIView):
    """GET, PUT and PATCH the logged-in user's profile."""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
