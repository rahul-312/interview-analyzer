"""
Gunicorn settings for serving the API. Start it from backend/ with `gunicorn config.wsgi`: gunicorn
reads this file automatically from the current directory, and command-line flags override it.

Voice debriefs call Gemini inside the request for up to VOICE_DEBRIEF_TIMEOUT_SECONDS (50 by
default), so:
- Workers are threaded (gthread). With plain sync workers each voice debrief holds a whole
  worker, and a few at once would stall every other request, logins and webhooks included.
- The worker timeout is longer than the voice timeout: gunicorn's default of 30 seconds would
  kill the worker first. Keep nginx's proxy_read_timeout at least as long (see deploy/nginx.conf).
- The graceful timeout on a restart is the same, so a deploy lets a voice debrief that's still
  running finish (or fail and be refunded) instead of killing it outright, which skips the refund.
"""
import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")
workers = int(os.environ.get("GUNICORN_WORKERS", "3"))
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", "8"))

# One value for both, so they can't drift apart.
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "75"))
graceful_timeout = timeout
