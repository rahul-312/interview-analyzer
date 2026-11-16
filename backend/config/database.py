"""Builds Django's DATABASES["default"] from a Postgres connection URL, such as the DATABASE_URL that
Neon's `neon env pull` writes (and Render, Vercel or Heroku-style hosts set).

Neon gives two URLs for the same database:
- DATABASE_URL, pooled (a `-pooler` host): PgBouncer in transaction mode, for the app's queries.
- DATABASE_URL_UNPOOLED, direct: for migrations and anything that keeps session state. Run
  `manage.py migrate` with DATABASE_URL set to this one.
"""
from urllib.parse import parse_qsl, unquote, urlsplit

SCHEMES = ("postgres", "postgresql")


def from_url(url: str, conn_max_age: int = 60) -> dict:
    parts = urlsplit(url)
    if parts.scheme not in SCHEMES:
        raise ValueError(f"DATABASE_URL must start with postgres:// or postgresql://, not {parts.scheme}://")
    if not parts.hostname or not parts.path.strip("/"):
        raise ValueError("DATABASE_URL needs a host and a database name")

    # Query parameters (sslmode, channel_binding, connect_timeout...) go to libpq as they are.
    options = dict(parse_qsl(parts.query))
    pooled = "-pooler" in parts.hostname
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": unquote(parts.path.lstrip("/")),
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname,
        "PORT": str(parts.port or 5432),
        "CONN_MAX_AGE": conn_max_age,
        "OPTIONS": options,
        # A transaction-mode pooler can hand each transaction a different server connection, which
        # breaks server-side cursors (QuerySet.iterator()). Django's docs say to turn them off.
        "DISABLE_SERVER_SIDE_CURSORS": pooled,
    }
