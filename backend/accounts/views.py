from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import ScopedRateThrottle

from .serializers import RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    """POST: create a new account. Throttled per IP: every account gets free AI runs on a billed key."""
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "signup"

    def check_throttles(self, request):
        pass  # checked in perform_create instead, so a mistyped form doesn't use up a sign-up

    def perform_create(self, serializer):
        super().check_throttles(self.request)
        serializer.save()


class MeView(generics.RetrieveUpdateAPIView):
    """GET, PUT and PATCH the logged-in user's profile."""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
