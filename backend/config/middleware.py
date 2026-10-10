from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone


class ClientTimezoneMiddleware:
    """
    Uses the time zone the client sends in X-Timezone (an IANA name like "Asia/Kolkata") for the
    request, so "today" (timezone.localdate()) is the user's day rather than the server's UTC one.
    Missing or unknown names fall back to settings.TIME_ZONE.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        zone = self._zone(request.headers.get("X-Timezone", ""))
        if zone:
            timezone.activate(zone)
        try:
            return self.get_response(request)
        finally:
            timezone.deactivate()

    @staticmethod
    def _zone(name):
        if not name or len(name) > 64:
            return None
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            return None
