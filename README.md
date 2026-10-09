# Interview Analyzer

Track job applications, debrief each interview round, get an analysis of what went wrong, and turn your recurring weak spots into a day-by-day prep plan.

- `backend/`: Django 5.2, Django REST Framework (generic views), SimpleJWT, Celery, and the Anthropic API
- `frontend/`: Next.js 15 (Pages Router), TypeScript, Tailwind CSS 4, lucide-react, Recharts

## Run it locally

You need Python 3.12+, Node 20+ and PostgreSQL. Create an empty database (for example `interview-analyzer`), then put its details in `backend/.env` (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`). You don't need Redis or an API key at first: jobs run inline and a rule-based analyzer is used.

**Backend** (terminal 1):

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py runserver
```

**Frontend** (terminal 2):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and create an account.

## Frontend structure

```
frontend/src/
├── pages/          thin route wrappers: _app, _document, login, register,
│                   applications, applications/[id], interviews, interviews/[id], analysis, prep
├── components/     one folder per feature, index.tsx composes small section files
│   ├── MainLayout/   auth guard, sticky navbar, page container
│   ├── Navbar/       NavLinks, NavButton, UserMenu, HamburgerMenu (mobile)
│   ├── Applications/, Interviews/, Analysis/, Prep/
│   ├── ApplicationForm/, RoundForm/, Modal/, Badges/, Charts/, Auth/, Logo/
│   └── ui/           Button, FormControls, Card, Feedback, PageHeader
├── context/        AuthContext, DialogsContext (shared pop-ups), RefreshContext
├── hooks/          useApi (load + poll), useAddApplication
├── services/       ApiClient plus one class per resource (ApplicationService, RoundService, ...)
├── models/         TypeScript types
├── config/         navItems, dropdown options
├── utils/          date formatting, error text
└── styles/         globals.css with @theme tokens (colours, spacing scale, text sizes)
```

Spacing uses the named scale from `globals.css` (`gap-4xl`, `px-6xl` and so on) instead of Tailwind's numbers. For widths, use the dedicated tokens (`max-w-content`, `max-w-modal`, `w-search`) rather than names like `max-w-xs` or `max-w-lg`, because those names overlap with the spacing scale.

## Tests and checks

```powershell
cd backend;  .venv\Scripts\python -m pytest -q
cd frontend; npm run lint; npm run build
```

## Redis and Claude

1. Start Redis (`docker compose up -d redis`). The compose file also has a Postgres you can use instead of a local one: set `DB_USER=interview`, `DB_PASSWORD=interview`, `DB_NAME=interview_analyzer`, `DB_PORT=5432`.
2. In `backend/.env`, set:
   ```
   CELERY_BROKER_URL=redis://localhost:6379/0
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Start the server again.
4. In a second terminal, start the worker. On Windows it needs `--pool=solo`:
   ```powershell
   celery -A config worker -l info --pool=solo
   ```

With an API key set, round analysis and prep plans use `claude-opus-5-5` with structured JSON output. The model can be changed with `ANTHROPIC_MODEL`. Server-side refusal fallback (`fallbacks: "default"`) is turned on.

## API

| Method | Path |
|---|---|
| POST | `/api/auth/register/`, `/api/auth/token/`, `/api/auth/token/refresh/` |
| GET/PATCH | `/api/auth/me/` |
| GET/POST | `/api/applications/` (`?status=`, `?search=`) |
| GET/PUT/PATCH/DELETE | `/api/applications/{id}/` |
| GET/POST | `/api/rounds/` (`?application=`; send `debrief` to save one) |
| GET/PUT/PATCH/DELETE | `/api/rounds/{id}/` |
| POST | `/api/rounds/{id}/analyze/` |
| GET/POST | `/api/prep-plans/` |
| GET/DELETE | `/api/prep-plans/{id}/` |
| POST | `/api/prep-plans/{id}/regenerate/` |
| PUT/PATCH | `/api/prep-tasks/{id}/` (only `done` is writable) |
| GET | `/api/insights/` |
