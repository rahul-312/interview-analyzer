from zoneinfo import ZoneInfo, available_timezones

from django.utils import timezone

# Every time zone name the server knows, read once. Names are only ever looked up in here, so
# anything else (a region like "Asia", a path, stray characters) is never handed to ZoneInfo.
KNOWN_ZONES = frozenset(available_timezones())


class ClientTimezoneMiddleware:
    """
    Uses the time zone the client sends in X-Timezone (an IANA name like "Asia/Kolkata") for the
    request, so "today" (timezone.localdate()) is the user's day rather than the server's UTC one.
    Missing or unknown names fall back to settings.TIME_ZONE.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        name = request.headers.get("X-Timezone", "")
        if name in KNOWN_ZONES:
            timezone.activate(ZoneInfo(name))
        try:
            return self.get_response(request)
        finally:
            timezone.deactivate()
