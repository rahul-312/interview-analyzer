# Interview Analyzer: build it yourself in VS Code

A step-by-step guide for building the MVP from an empty folder. Each step ends with a **Checkpoint** so you know it works before moving on.

There's a working reference copy of every file in [interview-analyzer-reference.zip](/mnt/project-files/plan/interview-analyzer-reference.zip). Write the code yourself, and open the matching file from the zip when you get stuck. The paths in this guide match the zip.

**Stack:** Django + DRF + SimpleJWT + PostgreSQL, Celery + Redis, Next.js 15 + TypeScript + Tailwind CSS 4 + Recharts, and the Gemini API for analysis.

**Time:** roughly 2 to 4 evenings. The backend is steps 1 to 9, the frontend is steps 10 to 17.

---

## 0. Before you start

Install these:

- Python 3.12 or newer
- Node 20 or newer
- PostgreSQL 16 and Redis 7. You can install them locally, or run only those two with Docker.
- VS Code extensions: Python, Pylance, ESLint, Tailwind CSS IntelliSense

You don't need Postgres, Redis or an API key on day one. The settings in step 2 fall back to SQLite, run background jobs inline, and use a rule-based analyzer until you add them.

## Final folder structure

```
interview-analyzer/
├── backend/
│   ├── config/            settings.py, urls.py, celery.py, __init__.py
│   ├── accounts/          serializers.py, views.py, urls.py
│   ├── tracker/
│   │   ├── models.py      Application, InterviewRound, Debrief, RoundAnalysis, PrepPlan, PrepTask
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── ai.py          Gemini calls + rule-based fallback
│   │   ├── insights.py    weak spots, pass rates, funnel
│   │   ├── tasks.py       Celery tasks
│   │   └── tests/
│   ├── requirements.txt
│   └── .env
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── login/, register/
│       │   └── (app)/applications, interviews, analysis, prep
│       ├── components/    AppShell, Dialogs, ApplicationForm, RoundForm, Modal, Badges, Charts, AuthProvider, AuthForm
│       └── lib/           api.ts, useApi.ts, types.ts, format.ts
├── docker-compose.yml
└── README.md
```

---

# Part 1: Backend

## 1. Create the project

```bash
mkdir interview-analyzer && cd interview-analyzer
git init
mkdir backend && cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install "django>=5.2,<6" djangorestframework djangorestframework-simplejwt django-cors-headers \
  "psycopg[binary]" dj-database-url python-dotenv celery redis google-genai pytest pytest-django
pip freeze > requirements.txt
django-admin startproject config .
python manage.py startapp accounts
python manage.py startapp tracker
```

In VS Code, press Ctrl+Shift+P and run "Python: Select Interpreter". Pick `backend/.venv`.

**Checkpoint:** `python manage.py runserver` shows the Django welcome page at http://localhost:8000.

## 2. Settings

Edit `config/settings.py`. Reference: `backend/config/settings.py` in the zip.

1. Load `.env` with `load_dotenv(BASE_DIR / ".env")`. Read `SECRET_KEY`, `DEBUG` and `ALLOWED_HOSTS` from environment variables.
2. Add to `INSTALLED_APPS`: `corsheaders`, `rest_framework`, `rest_framework_simplejwt`, `accounts`, `tracker`.
3. Put `corsheaders.middleware.CorsMiddleware` first in `MIDDLEWARE`.
4. Database: use Postgres when `DATABASE_URL` is set, and SQLite otherwise:
   ```python
   DATABASES = {"default": dj_database_url.config(default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60)}
   ```
5. DRF: use JWT auth for everything, and require login by default:
   ```python
   REST_FRAMEWORK = {
       "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
       "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
   }
   CORS_ALLOWED_ORIGINS = ["http://localhost:3000"]
   ```
6. Celery: with no broker set, run tasks inline so you don't need Redis yet:
   ```python
   CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "")
   CELERY_TASK_ALWAYS_EAGER = not CELERY_BROKER_URL
   ```
7. AI:
   ```python
   GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
   GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
   ```

Next, create `config/celery.py` (the standard Django Celery setup) and import the app in `config/__init__.py`:

```python
# config/celery.py
import os
from celery import Celery
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("interview_analyzer")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# config/__init__.py
from .celery import app as celery_app
__all__ = ("celery_app",)
```

**Checkpoint:** `python manage.py check` reports no issues.

## 3. Auth: register, login, me

The `accounts` app has no models and uses Django's built-in `User`.

- `accounts/serializers.py` has two serializers:
  - `RegisterSerializer` covers username, email, first_name and a write-only password. Run `validate_password` on the password, and create users with `User.objects.create_user`.
  - `UserSerializer` exposes id, username, email and first_name.
- `accounts/views.py` has two generic views:
  - `RegisterView(generics.CreateAPIView)` with `serializer_class = RegisterSerializer` and `permission_classes = [AllowAny]`.
  - `MeView(generics.RetrieveUpdateAPIView)` with `serializer_class = UserSerializer`. Override `get_object` to `return self.request.user`.
- `accounts/urls.py`: `register/` → `RegisterView.as_view()`, `token/` (SimpleJWT `TokenObtainPairView`), `token/refresh/`, `me/` → `MeView.as_view()`.
- `config/urls.py`: mount `api/auth/` → `accounts.urls` and `api/` → `tracker.urls`. Add the tracker one in step 6.

**Checkpoint:** migrate, then try it with curl or the VS Code REST Client:
```bash
python manage.py migrate
curl -X POST localhost:8000/api/auth/register/ -H "Content-Type: application/json" -d '{"username":"rahul","password":"a-strong-pass-123"}'
curl -X POST localhost:8000/api/auth/token/ -H "Content-Type: application/json" -d '{"username":"rahul","password":"a-strong-pass-123"}'
```
The second call should return `access` and `refresh` tokens.

## 4. Models

This is the heart of the app, so write `tracker/models.py` carefully. Six models:

| Model | Key fields | Notes |
|---|---|---|
| `Application` | user FK, company, role, date_applied, status, job_url, salary, source, contact, notes, job_description | Only company, role and date_applied are required (quick add). Status choices: applied, screening, interview, offer, rejected, withdrawn. Source choices: cold, referral, recruiter, job_board, other. |
| `InterviewRound` | application FK (`related_name="rounds"`), round_type, scheduled_at, interviewer, outcome | round_type: phone_screen, technical, system_design, behavioral, hiring_manager, take_home, onsite, other. outcome: pending, passed, failed. |
| `Debrief` | OneToOne round (`related_name="debrief"`), questions (JSONField), went_well, went_badly, interviewer_cues, recruiter_feedback, overall_feeling (1-5) | `questions` is a list of `{question, answer, topic, confidence 1-5}` |
| `RoundAnalysis` | OneToOne round (`related_name="analysis"`), status, source, summary, score (0-100), strengths, weaknesses, answer_reviews (JSON), error | weaknesses: `[{topic, severity: low/medium/high, evidence, advice}]` |
| `PrepPlan` | user FK, application FK, target_round FK (nullable), interview_date, status, source, summary, error | |
| `PrepTask` | plan FK (`related_name="tasks"`), date, topic, title, detail, minutes, done | ordered by date |

Add a shared `JobStatus` TextChoices with pending, running, done and failed. `RoundAnalysis` and `PrepPlan` both use it, because both are produced by a background job.

Why JSON fields for the debrief questions and analysis lists? They're always read and written as a whole, and the AI returns them in exactly that shape. That keeps the schema small.

```bash
python manage.py makemigrations tracker && python manage.py migrate
```

Register all six in `tracker/admin.py`.

**Checkpoint:** create a superuser, open http://localhost:8000/admin, and add an Application by hand.

## 5. Serializers

`tracker/serializers.py`. Reference file in the zip.

- **`ApplicationSerializer`**: all fields, plus read-only `rounds_count` (`source="rounds.count"`) and `status_label` (`source="get_status_display"`).
- **`DebriefQuestionSerializer`** (a plain `Serializer`) validates each question. `confidence` is an `IntegerField(min_value=1, max_value=5, allow_null=True)`.
- **`DebriefSerializer`** has `questions = DebriefQuestionSerializer(many=True)`.
- **`RoundAnalysisSerializer`** is read-only.
- **`InterviewRoundSerializer`** is the tricky one:
  - a nested writable `debrief` (optional), plus read-only `analysis`, `company`, `role` and `round_type_label`
  - `validate_application` rejects an application owned by another user. This is important for security.
  - override `create`/`update`: pop `debrief`, save the round, then `Debrief.objects.update_or_create(round=rnd, defaults=data)`. Set `self.debrief_saved = True` so the view knows to queue an analysis.
  - in `create`, call `advance_status(rnd)`. Logging a round moves an "applied" application to "interview" (or "screening" for a phone screen), so the funnel stays accurate.
- **`PrepTaskSerializer`** makes everything read-only except `done`.
- **`PrepPlanSerializer`** nests `tasks` read-only. In `validate`:
  - check that the application and round belong to the user
  - default `interview_date` to the target round's date
  - require one of the two

## 6. Views and URLs

`tracker/views.py` uses **generic views** for standard CRUD and plain **`APIView`** for the endpoints that aren't CRUD. This is the usual DRF best practice:

- Generic views handle lookups, 404s, validation, status codes and serializer context for you.
- `APIView` is for one-off actions like analyze, regenerate and insights.

Each resource gets a list view (`ListCreateAPIView`) and a detail view (`RetrieveUpdateDestroyAPIView`). Generic views handle PUT and PATCH separately, and return 204 on delete. The two hooks that matter:

- **`get_queryset`** scopes every query to `request.user`. This one method covers list, retrieve, update and delete, so another user's id returns 404 and nothing leaks.
- **`perform_create` / `perform_update`** are where you add the user or queue a background job.

Applications are the template:

```python
class ApplicationQuerysetMixin:
    """Limits every query to the logged-in user's applications."""
    def get_queryset(self):
        return Application.objects.filter(user=self.request.user)


class ApplicationListCreateView(ApplicationQuerysetMixin, generics.ListCreateAPIView):
    """
    GET: list the user's applications (supports ?status= and ?search=).
    POST: create an application. Only company, role and date_applied are required.
    """
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("search"):
            qs = qs.filter(Q(company__icontains=params["search"]) | Q(role__icontains=params["search"]))
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ApplicationDetailView(ApplicationQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """GET, PUT, PATCH and DELETE a single application."""
    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated]
```

Rounds queue an analysis whenever a debrief is saved:

```python
class RoundListCreateView(RoundQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = InterviewRoundSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        rnd = serializer.save()
        if serializer.debrief_saved:
            queue(analyze_round_task, rnd.id)
```

The non-CRUD endpoints use `APIView` with `get_object_or_404`, so you don't need `try/except DoesNotExist`:

```python
class RoundAnalyzeView(APIView):
    """Re-runs the analysis for a round that has a debrief."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        rnd = get_object_or_404(InterviewRound, pk=pk, application__user=request.user)
        if not hasattr(rnd, "debrief"):
            return Response({"detail": "Write a debrief first."}, status=status.HTTP_400_BAD_REQUEST)
        RoundAnalysis.objects.update_or_create(round=rnd, defaults={"status": JobStatus.PENDING})
        queue(analyze_round_task, rnd.id)
        return Response({"detail": "Analysis queued."}, status=status.HTTP_202_ACCEPTED)
```

All the views:

| View | Base class | Notes |
|---|---|---|
| `ApplicationListCreateView` | `ListCreateAPIView` | `?status=`, `?search=` filters. `perform_create` sets the user. |
| `ApplicationDetailView` | `RetrieveUpdateDestroyAPIView` | |
| `RoundListCreateView` | `ListCreateAPIView` | Queryset uses `application__user=request.user`, plus an optional `?application=`. Queues an analysis if `debrief_saved`. |
| `RoundDetailView` | `RetrieveUpdateDestroyAPIView` | `perform_update` also queues an analysis if `debrief_saved`. |
| `RoundAnalyzeView` | `APIView` | `post`. Returns 400 without a debrief, and 202 when queued. |
| `PrepPlanListCreateView` | `ListCreateAPIView` | `perform_create` saves with the user and queues `generate_plan_task`. |
| `PrepPlanDetailView` | `RetrieveDestroyAPIView` | Plans aren't edited, only regenerated. |
| `PrepPlanRegenerateView` | `APIView` | `post`. Resets the status to pending, queues the job, and returns 202. |
| `PrepTaskDetailView` | `UpdateAPIView` | Queryset uses `plan__user=request.user`. Only `done` is writable. |
| `InsightsView` | `APIView` | `get` returns `weak_spots`, `round_outcomes`, `funnel`, `analysed_rounds` and `ai_enabled`. |

`tracker/urls.py`:

```python
urlpatterns = [
    path("applications/", ApplicationListCreateView.as_view()),
    path("applications/<int:pk>/", ApplicationDetailView.as_view()),
    path("rounds/", RoundListCreateView.as_view()),
    path("rounds/<int:pk>/", RoundDetailView.as_view()),
    path("rounds/<int:pk>/analyze/", RoundAnalyzeView.as_view()),
    path("prep-plans/", PrepPlanListCreateView.as_view()),
    path("prep-plans/<int:pk>/", PrepPlanDetailView.as_view()),
    path("prep-plans/<int:pk>/regenerate/", PrepPlanRegenerateView.as_view()),
    path("prep-tasks/<int:pk>/", PrepTaskDetailView.as_view()),
    path("insights/", InsightsView.as_view()),
]
```

With no `DEFAULT_PAGINATION_CLASS` set, list endpoints return a plain JSON array, so `api.ts` (step 12) can expect an array. If you add pagination later, the response becomes `{count, next, previous, results}`.

**Endpoints you'll have:**

| Method | Path |
|---|---|
| CRUD | `/api/applications/` |
| CRUD | `/api/rounds/` (send `debrief` to save one) |
| POST | `/api/rounds/{id}/analyze/` |
| GET | `/api/insights/` |
| GET/POST/DELETE | `/api/prep-plans/`, POST `/api/prep-plans/{id}/regenerate/` |
| PATCH | `/api/prep-tasks/{id}/` |

**Checkpoint:** while logged in, the DRF browsable API at http://localhost:8000/api/applications/ lists your applications. Use the access token with a ModHeader-style browser extension, or test with curl.

## 7. The analyzer: `tracker/ai.py`

Build it in two layers, so the app works before you have an API key.

**Layer 1: rule-based fallback (build this first).**
- `rule_based_analysis(context)` loops over the debrief questions:
  - confidence ≤ 2 → a weakness (severity high if 1, medium if 2) with evidence like `You rated your answer to "…" 1/5`, plus advice looked up by topic keyword (system design, behavioral, coding, sql)
  - confidence ≥ 4 → a strength
- Attach the `went_badly` text as extra evidence on the worst weakness.
- Score = average confidence × 20.
- `rule_based_plan(context)`: take the weak-spot topics first, then a few basics for the round type. Put one topic on each day, and make the last day "light review and mock run-through".

**Layer 2: Gemini.** Call it only when `GEMINI_API_KEY` is set. Use structured output, so the reply is JSON matching a schema:

```python
from google import genai
from google.genai import types

response = genai.Client(api_key=settings.GEMINI_API_KEY).models.generate_content(
    model=settings.GEMINI_MODEL,
    contents=prompt,
    config=types.GenerateContentConfig(
        system_instruction=ANALYSIS_SYSTEM,
        max_output_tokens=16000,
        response_mime_type="application/json",
        response_json_schema=ANALYSIS_SCHEMA,
    ),
)
if response.prompt_feedback and response.prompt_feedback.block_reason:  # the prompt itself was blocked: no candidates
    raise RuntimeError("The AI declined to analyse this content.")
if response.candidates[0].finish_reason != "STOP":  # blocked, cut off, or unfinished: the text is partial
    raise RuntimeError("The AI didn't finish its reply. Try again.")
return json.loads(response.text)
```

The schemas are plain JSON Schema objects with `"additionalProperties": False` and every field in `"required"`. Copy `ANALYSIS_SCHEMA`, `PLAN_SCHEMA` and the two system prompts from the reference `ai.py`.

`analyze_round(context)` and `generate_plan(context)` return `(result, "ai")` or `(result, "rules")`, so the UI can show which one ran.

## 8. Background jobs: `tracker/tasks.py`

- `build_analysis_context(round)` puts the company, role, job description, round type and date, and the full debrief into a dict.
- `@shared_task analyze_round_task(round_id)`:
  1. Mark the analysis as running.
  2. Call `ai.analyze_round`.
  3. Save the fields and mark it done. On any exception, mark it failed and store the error message.
- `build_plan_context(plan)` takes the application, JD, round type, number of days (today to the interview, capped at 14) and the top 8 weak spots.
- `@shared_task generate_plan_task(plan_id)` deletes the old tasks, bulk-creates new `PrepTask`s (day N → date), and marks the plan done.
- A `queue(task, *args)` helper uses `transaction.on_commit(lambda: task.delay(*args))`. The worker must never run before the row is saved.

## 9. Insights: `tracker/insights.py`

- `weak_spots(user)` loops over every finished `RoundAnalysis`. It groups weaknesses by normalized topic (lowercase, collapsed spaces) and scores each group as low=1, medium=2, high=3. It returns the groups sorted worst first, each with count, high count, latest advice, and the rounds it appeared in.
- `round_outcomes(user)` counts passed/failed/pending per round type and computes a pass rate. The lowest pass rate is "where you drop out".
- `funnel(user)` counts how many applications reached each stage (applied → screening → interview → offer), with conversion from the previous stage, a breakdown by source, and status counts.

## 9b. Tests

Create `pytest.ini` with `DJANGO_SETTINGS_MODULE = config.settings`, plus `tracker/tests/conftest.py`:
- a fixture that blanks the API key and forces Celery eager mode
- `user`, `api` (an `APIClient` with `force_authenticate`) and `application` fixtures

Write tests for:
- quick add with only company, role and date
- another user can't see or use your data
- a debrief produces an analysis
- the same topic in two rounds ranks first in weak spots
- the funnel counts
- a prep plan targets weak spots, and its last day is a review day

The reference has 10 tests, including one that sends a real Gemini SDK request to a mocked HTTP server.

**Checkpoint:** `pytest -q` passes. The backend is done.

---

# Part 2: Frontend

## 10. Create the Next.js app

From the repo root:

```bash
npx create-next-app@15 frontend --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd frontend
npm i recharts
echo "NEXT_PUBLIC_API_URL=http://localhost:8000/api" > .env.local
```

Delete the starter `page.tsx` content and the SVGs in `public/`.

## 11. Styles

In `src/app/globals.css`, keep `@import "tailwindcss";` and define a few reusable classes with Tailwind 4's `@utility`: `input`, `label`, `btn`, `btn-primary`, `btn-secondary`, `btn-danger`, `card`. Every form and page then uses `className="btn-primary"` and so on. Reference: `frontend/src/app/globals.css`.

## 12. The lib folder

- **`lib/types.ts`**: TypeScript interfaces that mirror the serializers (Application, InterviewRound, Debrief, Analysis, PrepPlan, PrepTask, Insights), plus the option lists for the status, source, round type and outcome dropdowns.
- **`lib/api.ts`**: one `api<T>(path, {method, body})` function.
  - It adds `Authorization: Bearer <access>` from localStorage.
  - On a 401, it calls `/auth/token/refresh/` once and retries. If that fails, it clears the tokens and redirects to `/login`.
  - It throws an `ApiError` holding the DRF error body.
  - An `errorText(err)` helper turns `{"role": ["This field is required."]}` into one readable line.
- **`lib/useApi.ts`**: a `useApi<T>(path, pollWhile?)` hook that returns `{data, error, loading, reload, setData}`.
  - It refetches whenever the shared "refresh key" changes (step 14).
  - It polls every 2 seconds while `pollWhile(data)` is true. That's how a "Analysing…" badge turns into the result without a page refresh.
- **`lib/format.ts`**: date helpers (`formatDate`, `toLocalInput` for datetime-local inputs, `daysUntil`).

## 13. Auth

- **`components/AuthProvider.tsx`**: a React context with `user`, `ready`, `login`, `register` and `logout`. On mount, if there's a token, it calls `/auth/me/`.
- **`components/AuthForm.tsx`**: one form used for both login and register.
- Pages `app/login/page.tsx` and `app/register/page.tsx` just render `<AuthForm mode="…" />`.
- Wrap `app/layout.tsx` children in `<AuthProvider>`.

**Checkpoint:** you can register and log in, and the tokens appear in localStorage.

## 14. The shared "+ Add application" pop-up (the key piece)

This is what puts the add button on every tab.

1. **`components/Modal.tsx`**: an overlay with a panel. It closes on Escape or a backdrop click, and is a bottom sheet on mobile.
2. **`components/ApplicationForm.tsx`**: in `quick` mode it shows only company, role, date and status, with an "Add more details (optional)" toggle for link, source, salary, contact, JD and notes. The same component is reused for editing.
3. **`components/RoundForm.tsx`**: a round's type, date, interviewer and outcome. A checkbox "This round is done: write a debrief" reveals the debrief:
   - a dynamic list of questions, each with an answer, a topic and a 1-5 rating
   - went well, went badly, interviewer cues, recruiter feedback, and overall feeling
4. **`components/Dialogs.tsx`**: a context provider that owns both modals. It exposes:
   - `openAddApplication({ afterCreate })`
   - `openRoundForm({ applicationId, round, withDebrief, afterSave })`
   - `bump()`, which increments a refresh key so every `useApi` refetches after a save
5. **`components/AppShell.tsx`** has:
   - a header with the "+ Add application" button (hidden on mobile, where a floating round **+** button shows instead)
   - the four tabs as links, highlighting the active one with `usePathname()`
   - a redirect to `/login` when there's no user

   After saving, the button's `afterCreate` checks the current tab:

   | Tab | After the application is created |
   |---|---|
   | Applications | open the new application's page |
   | Interviews | open "Log an interview round" for it |
   | Analysis | open the round form with the debrief expanded |
   | Prep | go to `/prep?new=<id>`, which opens the new-plan form |

6. **`app/(app)/layout.tsx`** renders `<AppShell>{children}</AppShell>`. The `(app)` folder is a route group: it adds the shell to the four tabs without changing their URLs.

**Checkpoint:** the button opens the pop-up on every tab, and saving creates the application.

## 15. Applications tab

- **`app/(app)/applications/page.tsx`**:
  - status filter chips with counts and a search box
  - a list of applications, each with a status badge and an inline status dropdown (PATCH on change)
  - an empty state with a "+ Add your first application" button
- **`app/(app)/applications/[id]/page.tsx`**:
  - the details, an Edit toggle (reusing `ApplicationForm`), and Delete
  - the list of rounds with outcome badges, plus "+ Log round" and "Make a prep plan"
  - "Write debrief" or "View analysis" on each round

## 16. Interviews tab

- **`app/(app)/interviews/page.tsx`**:
  - an Upcoming section with an "in N days" label and a "Prep plan" link
  - a Past section with a "need a debrief" counter and "Write debrief" buttons
  - it polls while any analysis is pending
- **`app/(app)/interviews/[id]/page.tsx`** is the analysis view:
  - a score ring and summary
  - **What went wrong** (topic, severity badge, evidence, fix)
  - What went well
  - **Answer by answer** (verdict and a stronger answer)
  - a collapsible "Your debrief", plus Re-analyse, Edit debrief and Delete buttons
  - a note when the rule-based analyzer was used

## 17. Analysis and Prep tabs

- **`components/Charts.tsx`**: one reusable single-series Recharts `BarChart` with a hover tooltip and rounded bar tops.
- **`app/(app)/analysis/page.tsx`** has:
  - four stat tiles: applications, reached interviews, offers, rounds analysed
  - **Your weak spots**, ranked worst first. Each has a fix and chips linking to the rounds it came from, and there's a "Turn these into a prep plan" button.
  - pass rate by round type (chart and table), with a line saying where you drop out most
  - the pipeline chart, plus a by-source table
- **`app/(app)/prep/page.tsx`** has:
  - a new-plan form: pick the application, then an upcoming round, or a date if none is scheduled. It reads `?new=` and `?round=` from the URL, which needs a `<Suspense>` wrapper because of `useSearchParams`.
  - plan cards with the summary, an "N days to go" label, a progress bar and tasks grouped by day with checkboxes (PATCH `done`), plus Regenerate and Delete

**Checkpoint:** `npm run lint && npm run build` pass. Then click through the full loop: add an application, log a past round with a debrief, read the analysis, schedule an upcoming round, make a prep plan, and tick a task.

---

# Part 3: Real services and AI

## 18. Postgres, Redis and the Celery worker

```bash
# Start Postgres and Redis, either installed locally or with docker compose (the reference compose file is in the zip)
# backend/.env:
DATABASE_URL=postgres://interview:interview@localhost:5432/interview_analyzer
CELERY_BROKER_URL=redis://localhost:6379/0

python manage.py migrate
python manage.py runserver
celery -A config worker -l info          # in a second VS Code terminal
```

Now analysis runs in the worker. You'll briefly see a "Queued" or "Analysing" badge in the UI before the result appears.

## 19. Turn on Gemini

Get a free key at aistudio.google.com/apikey and put it in `backend/.env`:
```
GEMINI_API_KEY=...
```
Restart the server and worker. New analyses will show the full AI review, and the "rule-based" note disappears. Never commit `.env`: add it to `.gitignore` on day one.

## 20. Nice to have

- `.github/workflows/ci.yml` runs backend tests against Postgres, plus frontend lint and build, on every push. A reference copy is in the zip.
- `backend/Dockerfile` and `docker-compose.yml` for running everything with one command.
- Deploy the frontend to Vercel, and Django, Postgres and Redis to Render or Railway.

---

## Suggested commit order

1. Django project, settings, auth
2. Models and admin
3. Serializers, views, URLs
4. Rule-based analyzer, tasks, insights, tests
5. Next.js setup, lib, auth pages
6. AppShell and shared dialogs
7. Applications and Interviews tabs
8. Analysis and Prep tabs
9. Celery and Postgres config, Gemini integration, CI
