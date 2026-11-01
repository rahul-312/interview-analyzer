from rest_framework import generics
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


class MeView(generics.RetrieveUpdateAPIView):
    """GET, PUT and PATCH the logged-in user's profile."""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
