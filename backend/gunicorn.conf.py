"""
Gunicorn settings for serving the API. Gunicorn reads this file automatically when started from
backend/ (gunicorn config.wsgi), and command-line flags override it.

Voice debriefs call Gemini inside the request for up to VOICE_DEBRIEF_TIMEOUT_SECONDS (50 by
default), so the worker timeout must be longer: gunicorn's default of 30 seconds would kill the
worker first. Keep nginx's proxy_read_timeout at least as long (see deploy/nginx.conf).
"""
import os

bind = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")
workers = int(os.environ.get("GUNICORN_WORKERS", "3"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "75"))
graceful_timeout = 30
