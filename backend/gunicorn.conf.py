"""
Gunicorn settings for serving the API. Start it from backend/ with `gunicorn config.wsgi`: gunicorn
reads this file automatically from the current directory, and command-line flags override it.

Voice debriefs call Gemini inside the request for up to VOICE_DEBRIEF_TIMEOUT_SECONDS (50 by
default), so:
- Workers are threaded (gthread). With plain sync workers each voice debrief holds a whole
  worker, and a few at once would stall every other request, logins and webhooks included.
- Gemini's own timeout is what ends a slow voice debrief. With gthread, `timeout` only restarts a
  worker whose main loop is stuck; it doesn't stop a slow request in a thread. It's kept above the
  voice timeout anyway, so it can't cut one short if the worker class is changed to sync.
- The graceful timeout on a restart matches it, so a deploy lets a voice debrief that's still
  running finish (or fail and be refunded) instead of killing it outright, which skips the refund.
- Keep nginx's proxy_read_timeout at least as long (see deploy/nginx.conf).

Database connections: each thread keeps its own (CONN_MAX_AGE), so a server opens up to
workers x threads of them (24 by default), plus the Celery workers'. Keep the total across all
servers under Postgres's max_connections (100 by default).
"""
import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")
workers = int(os.environ.get("GUNICORN_WORKERS", "3"))
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", "8"))

# One value for both, so they can't drift apart.
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "75"))
graceful_timeout = timeout
