import os
from datetime import timedelta
from pathlib import Path

from corsheaders.defaults import default_headers
from dotenv import dotenv_values
from kombu import Queue

BASE_DIR = Path(__file__).resolve().parent.parent
# backend/.env fills in only variables that are unset or empty. A real value set in the environment
# (systemd, Docker, the hosting platform) wins, so DEBUG=0 there can't be undone by a copied .env;
# an empty variable left over in a terminal doesn't hide the .env value.
# When debugging locally, two things follow from this:
# - A variable still exported in your terminal (say DEBUG or DB_NAME from another project) beats
#   .env. Check `env` if a setting isn't what .env says.
# - Setting a variable to empty can't switch a .env value off for one run (GEMINI_API_KEY= ... still
#   uses the key from .env). Comment the line out in .env. For flags, set an explicit value such as
#   DEBUG=0.
for _key, _value in dotenv_values(BASE_DIR / ".env").items():
    if _value is not None and not os.environ.get(_key):
        os.environ[_key] = _value

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = os.environ.get("DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "accounts",
    "tracker",
    "billing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Serves collected static files (the admin's CSS and JS) when DEBUG is off.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "config.middleware.ClientTimezoneMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "interview-analyzer"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5433"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# Where `manage.py collectstatic` puts static files for WhiteNoise to serve in production.
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        # Lets the browsable API work after logging in at /admin/.
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # Only views that set throttles are: billing calls that reach Razorpay, and sign-ups (per IP, see
    # accounts/throttles.py), since every new account gets free AI runs.
    "DEFAULT_THROTTLE_RATES": {
        "billing": os.environ.get("BILLING_THROTTLE_RATE", "20/min"),
        "signup": os.environ.get("SIGNUP_THROTTLE_RATE", "10/hour"),
        "signup_attempt": os.environ.get("SIGNUP_ATTEMPT_THROTTLE_RATE", "60/min"),
    },
    # Reverse proxies in front of the API (1 behind nginx or a load balancer). The throttles trust only the
    # X-Forwarded-For entry the last proxy added; with 0 they use the connection's address, so a client
    # can't dodge the sign-up limit by sending a made-up header.
    "NUM_PROXIES": int(os.environ.get("NUM_PROXIES") or 0),
}

# Behind a proxy that terminates TLS, trust its X-Forwarded-Proto so Django knows the request was
# HTTPS (is_secure, absolute URLs). Only then: without a proxy, a client could send the header itself.
if REST_FRAMEWORK["NUM_PROXIES"] > 0:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# The API uses JWTs, so cookies only matter for the admin: in production, send them over HTTPS only.
# So with DEBUG=0 over plain http://localhost, the browser drops these cookies and the admin login
# fails with a CSRF error. Test the admin locally with DEBUG=1, or over HTTPS.
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
# X-Timezone: the browser's time zone, so dates like "applied today" use the user's day.
CORS_ALLOW_HEADERS = (*default_headers, "x-timezone")

# Shared cache, which the billing rate limit counts in. Set CACHE_URL (e.g. redis://localhost:6379/1)
# whenever more than one process serves the API: the default per-process cache counts each one separately.
CACHE_URL = os.environ.get("CACHE_URL", "")
if CACHE_URL:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": CACHE_URL}}

# Celery: with no broker configured, tasks run inline so Redis isn't needed yet.
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "")
CELERY_TASK_ALWAYS_EAGER = not CELERY_BROKER_URL
CELERY_TASK_EAGER_PROPAGATES = False
# Seconds to wait before retrying an AI call that failed without being billed. Without a broker,
# jobs run inside the web request, so don't sleep there: fail fast and let the user retry.
AI_RETRY_DELAYS = (1, 3) if CELERY_BROKER_URL else ()

# Round analyses allowed in any rolling 24 hours, by plan (None = unlimited). Pro Plus is shown
# as "Unlimited, fair use", but its fair-use allowance is enforced like any other limit.
PLAN_ANALYSES_PER_24H = {
    "free": int(os.environ.get("FREE_ANALYSES_PER_24H", "2")),
    "pro": int(os.environ.get("PRO_ANALYSES_PER_24H", "15")),
    "pro_plus": int(os.environ.get("PRO_PLUS_ANALYSES_PER_24H", "50")),
}

# Prep plans generated (new or regenerated) in any rolling 24 hours, by plan (None = unlimited).
PLAN_PREP_PLANS_PER_24H = {
    "free": int(os.environ.get("FREE_PREP_PLANS_PER_24H", "1")),
    "pro": int(os.environ.get("PRO_PREP_PLANS_PER_24H", "5")),
    "pro_plus": int(os.environ.get("PRO_PLUS_PREP_PLANS_PER_24H", "15")),
}

# Debriefs filled in by voice in any rolling 24 hours, by plan. Audio is the costliest input, and on a
# free-tier key every user shares one daily quota with analyses, so Free gets only a few.
PLAN_VOICE_DEBRIEFS_PER_24H = {
    "free": int(os.environ.get("FREE_VOICE_DEBRIEFS_PER_24H", "3")),
    "pro": int(os.environ.get("PRO_VOICE_DEBRIEFS_PER_24H", "15")),
    "pro_plus": int(os.environ.get("PRO_PLUS_VOICE_DEBRIEFS_PER_24H", "40")),
}

# Failed analyses and prep plans that already cost an API call (timeouts, cut-off or unreadable replies, our
# own errors) are given back, up to this many per user in 24 hours. Past it they count, so
# nobody can retry an expensive failure for free. Failures that cost nothing are always refunded.
BILLED_REFUNDS_PER_24H = int(os.environ.get("BILLED_REFUNDS_PER_24H", "3"))

# AI: without a key, the rule-based analyzer is used.
# Largest voice-debrief upload accepted, checked against the request's Content-Length before any of it
# is read. It's the size before encoding: Gemini's 20 MB request limit applies after base64, which
# adds a third, so keep this under 15,000,000. The app's recorder (Opus, ~32 kbit/s) makes about
# 2.5 MB in its 10 minutes; Safari may ignore the bitrate and make up to about 10 MB. Cap request
# bodies at the proxy too (nginx: client_max_body_size 15m).
VOICE_DEBRIEF_MAX_BYTES = int(os.environ.get("VOICE_DEBRIEF_MAX_BYTES") or 14_000_000)
# How long a voice debrief waits for Gemini. It runs inside the web request, so the app server's
# worker timeout and the proxy's read timeout must both be longer (e.g. gunicorn --timeout 75,
# nginx proxy_read_timeout 75s): otherwise the worker is stopped first and the user gets a bare 502.
# The call is then given back only while under the billed-refund cap, and not at all if the worker
# is killed outright (SIGKILL) before the refund runs. Gunicorn's default of 30 seconds is too short.
VOICE_DEBRIEF_TIMEOUT_SECONDS = int(os.environ.get("VOICE_DEBRIEF_TIMEOUT_SECONDS") or 50)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
# The better model Pro Plus jobs use. Blank: Pro Plus uses GEMINI_MODEL too.
GEMINI_PRO_MODEL = os.environ.get("GEMINI_PRO_MODEL", "")
# Whether the key is on Gemini's free tier (no billing on its project). Set to false for a paid key.
GEMINI_FREE_TIER = os.environ.get("GEMINI_FREE_TIER", "true").lower() not in ("false", "0", "no")
# A key on a paid (billing-enabled) project. Jobs for paid plans, whose debriefs must not be used for
# training, only ever go to a paid-tier key: this one, or GEMINI_API_KEY when GEMINI_FREE_TIER is false.
# With neither, paid plans get the rule-based engine rather than a free-tier key.
GEMINI_PAID_API_KEY = os.environ.get("GEMINI_PAID_API_KEY", "")
# An API key for Gemini on Vertex AI (Google Cloud). When set, every plan's jobs use it instead of the
# keys above: it bills a Google Cloud project, so it's a paid tier, and it's far more reliable under load.
VERTEX_API_KEY = os.environ.get("VERTEX_API_KEY", "")

# Celery queue for priority plans (Pro Plus). A worker started without -Q serves both queues, so
# nothing waits on a worker that isn't running; a dedicated `-Q priority` worker makes it a real
# priority lane (see BILLING.md).
CELERY_PRIORITY_QUEUE = os.environ.get("CELERY_PRIORITY_QUEUE", "priority")
CELERY_TASK_DEFAULT_QUEUE = "celery"
CELERY_TASK_QUEUES = tuple(Queue(name) for name in dict.fromkeys([CELERY_TASK_DEFAULT_QUEUE, CELERY_PRIORITY_QUEUE]))

# Razorpay. Use rzp_test_ keys (and test-mode plan IDs) everywhere but production.
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_API_URL = os.environ.get("RAZORPAY_API_URL", "https://api.razorpay.com/v1")
# Billing cycles a subscription runs for before it completes (Razorpay requires a total).
RAZORPAY_TOTAL_COUNT = {
    "month": int(os.environ.get("RAZORPAY_MONTHLY_TOTAL_COUNT", "120")),
    "year": int(os.environ.get("RAZORPAY_YEARLY_TOTAL_COUNT", "10")),
}
# Days a subscription whose renewal failed (Razorpay status "pending", still retrying) keeps paid
# access after its paid period ends. Halted, cancelled and completed subscriptions get none.
BILLING_GRACE_DAYS = int(os.environ.get("BILLING_GRACE_DAYS", "3"))
# Money-back window: cancelling now within this many days of a new subscription's first payment
# refunds it in full, once per user. 0 turns it off.
BILLING_REFUND_DAYS = int(os.environ.get("BILLING_REFUND_DAYS", "7"))
# A checkout for the same plan within this many minutes reuses the subscription already created.
BILLING_CHECKOUT_REUSE_MINUTES = int(os.environ.get("BILLING_CHECKOUT_REUSE_MINUTES", "30"))
# Send our own billing emails (activation, renewal, failed payment, cancellation) as well as Razorpay's.
BILLING_EMAILS = os.environ.get("BILLING_EMAILS", "false").lower() in ("true", "1", "yes")
