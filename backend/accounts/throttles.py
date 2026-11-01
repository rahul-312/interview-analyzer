"""Per-IP limits on sign-ups, since every new account gets AI runs on a billed key."""
import logging

from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle

logger = logging.getLogger(__name__)
_warned_about_proxies = False


class PerIpThrottle(SimpleRateThrottle):
    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

    def get_ident(self, request):
        global _warned_about_proxies
        if not api_settings.NUM_PROXIES and "HTTP_X_FORWARDED_FOR" in request.META and not _warned_about_proxies:
            # Behind a proxy with NUM_PROXIES=0, every user shares the proxy's IP and its limit
            _warned_about_proxies = True
            logger.warning(
                "A request came with X-Forwarded-For but NUM_PROXIES is 0, so rate limits use the connection's IP. "
                "If a reverse proxy serves the API, set NUM_PROXIES, or all users share one sign-up limit. "
                "Without a proxy this is harmless: the client sent the header itself."
            )
        return super().get_ident(request)

    def wait(self):
        # DRF gives no wait when the count is already over the limit (simultaneous requests); the
        # oldest counted request expiring frees the next slot
        wait = super().wait()
        if wait is None and self.history:
            wait = max(0, self.duration - (self.now - self.history[-1]))
        return wait


class SignupAttemptThrottle(PerIpThrottle):
    """Every register request, valid or not, so usernames can't be probed without limit."""
    scope = "signup_attempt"


class SignupThrottle(PerIpThrottle):
    """Accounts actually created."""
    scope = "signup"
