# Interview Analyzer

Track job applications, debrief each interview round, get an analysis of what went wrong, and turn your recurring weak spots into a day-by-day prep plan.

- `backend/`: Django 5.2, Django REST Framework (generic views), SimpleJWT, Celery, and the Gemini API
- `frontend/`: Next.js 15 (Pages Router), TypeScript, Tailwind CSS 4, lucide-react, Recharts

There are three plans: Free, Pro and Pro Plus. Paid plans are billed through Razorpay subscriptions, and every limit is enforced by the backend. See [BILLING.md](BILLING.md) for the plans, the policies, Razorpay setup and deployment.

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

## Browser extension

`extension/` is a Chrome extension (it also works in Edge and Brave) for saving jobs without leaving the job site. On any job site or company careers page it adds a **+ Track** button to every job card in a list and a **+ Save to Interview Analyzer** button to each job's page. If a page isn't recognised as a job, click the extension's toolbar icon and choose **Save the job on this page**. Either way, the same "Add application" pop-up opens on the page, already filled in.

To install it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/src` folder. The first time you save a job, the pop-up sends you to the extension's own sign-in page. After changing the extension's code, click its reload button on that page and reload the job site.

The extension's code is in `extension/src`. It has no build step:

- `background.js`: the only part that calls the API, and the only one that sees the JWT tokens. It keeps them and the server addresses in its own IndexedDB, which scripts on job sites can't read. Job sites can only ask it to save a job, look jobs up, or open the sign-in page. Signing in and changing settings work only from the extension's own pages. Its requests don't go through CORS.
- `content/sites.js`: reads the job from the page, the same way on every site: the schema.org `JobPosting` (when its title is on screen), then what's on screen (the job's heading, elements named like a company or salary, the block under headings like "Responsibilities"), then the page title ("Role at Company", "Company hiring Role"…). Selected text replaces the description. Job lists are found the same way: each link to a single job (a job word as a whole part of its address followed by an id, or `?jk=`, `?gh_jid=`…; never in news or blog sections) in the largest block around it that links to no other job. Links to other sites' jobs (a careers page linking to Greenhouse or Lever) get cards too, but only jobs on the page's own site are looked up for "✓ Saved", so a page can't find out which other sites' jobs are saved. Subdomains of shared hosts (github.io, vercel.app…) count as separate sites. At most 500 jobs are looked up per page. No site has code of its own; tracking parameters stripped from links are in `TRACKING`.
- `content/content.js`: the buttons. Card buttons sit in a layer of their own over the page, never inside the site's lists, and only show where their card is on top (not under the site's headers or pop-ups). The scripts don't run on the email, banking, payment and password-manager sites listed under `exclude_matches` in `manifest.json`.
- `content/ui.js`, `content/content.js`: the pop-up and buttons (in shadow roots, so the site's CSS doesn't affect them) and the code that places them. The "✓ Saved" marks are checked against the app in batches, and again when you come back to the tab. The pop-up never asks for a password, because the job site can see what's typed into it.
- `popup/`: the toolbar popup (sign in and out, save the current page, server addresses) and, opened with `?signin=1`, the sign-in page. Server addresses must be https, except for localhost (http://localhost:8000/api and http://localhost:3000 by default).

The tests (`extension/tests`, run with jsdom) sit outside `src` so their packages never end up in the extension.

## Frontend structure

```
frontend/src/
├── pages/          thin route wrappers: _app, _document, login, register,
│                   applications, applications/[id], interviews, interviews/[id], analysis, prep,
│                   pricing, billing
├── components/     one folder per feature, index.tsx composes small section files
│   ├── MainLayout/   auth guard, sticky navbar, page container
│   ├── Navbar/       NavLinks, NavButton, UserMenu, HamburgerMenu (mobile)
│   ├── Applications/, Interviews/, Analysis/, Prep/
│   ├── Billing/      pricing page, plans & billing dashboard, cancel dialog
│   ├── ApplicationForm/, RoundForm/, Modal/, Badges/, Charts/, Auth/, Logo/
│   └── ui/           Button, FormControls, Card, Feedback, PageHeader
├── context/        AuthContext, DialogsContext (shared pop-ups), RefreshContext
├── hooks/          useApi (load + poll), useAddApplication, useCheckout (Razorpay Checkout)
├── services/       ApiClient plus one class per resource (ApplicationService, RoundService, ...)
├── models/         TypeScript types
├── config/         navItems, dropdown options
├── utils/          date formatting, error text, prices and plan wording (billing.ts)
└── styles/         globals.css with @theme tokens (colours, spacing scale, text sizes)
```

Spacing uses the named scale from `globals.css` (`gap-4xl`, `px-6xl` and so on) instead of Tailwind's numbers. For widths, use the dedicated tokens (`max-w-content`, `max-w-modal`, `w-search`) rather than names like `max-w-xs` or `max-w-lg`, because those names overlap with the spacing scale.

## Tests and checks

```powershell
cd backend;   .venv\Scripts\python -m pytest -q
cd frontend;  npm run lint; npm test; npm run build
cd extension; npm install; npm test
```

## Redis and Gemini

1. Start Redis (`docker compose up -d redis`). The compose file also has a Postgres you can use instead of a local one: set `DB_USER=interview`, `DB_PASSWORD=interview`, `DB_NAME=interview_analyzer`, `DB_PORT=5432`.
2. In `backend/.env`, set:
   ```
   CELERY_BROKER_URL=redis://localhost:6379/0
   GEMINI_API_KEY=...
   ```
3. Start the server again.
4. In a second terminal, start the worker. On Windows it needs `--pool=solo`:
   ```powershell
   celery -A config worker -l info --pool=solo
   ```

With an API key set, round analysis and prep plans use `gemini-3.8-flash` with structured JSON output. The model can be changed with `GEMINI_MODEL`. Get a free key at https://aistudio.google.com/apikey. The free tier has a small daily request limit per model; for more requests a day, set `GEMINI_MODEL=gemini-3.5-flash-lite`. Free-tier prompts may be used by Google to improve its products and reviewed by people, so the app tells users this next to the debrief and prep-plan forms whenever AI is on. With a paid key, set `GEMINI_FREE_TIER=false` and the notice only says the text goes to Gemini. Google's terms don't allow the free tier for apps serving users in the EEA, UK or Switzerland: use a paid key for anything beyond a personal deployment. If the key or model is wrong, analyses fail with "The AI isn't set up correctly on the server", and the server log has Gemini's full answer and which setting to check.

## API

| Method | Path |
|---|---|
| POST | `/api/auth/register/`, `/api/auth/token/`, `/api/auth/token/refresh/` |
| GET/PATCH | `/api/auth/me/` |
| GET/POST | `/api/applications/` (`?status=`, `?search=`, `?job_url=`) |
| POST | `/api/applications/lookup/` (`{"job_urls": [...]}`: which are saved, as `{"matches": {url: id}}`) |
| GET/PUT/PATCH/DELETE | `/api/applications/{id}/` |
| GET/POST | `/api/rounds/` (`?application=`; send `debrief` to save one) |
| GET/PUT/PATCH/DELETE | `/api/rounds/{id}/` |
| POST | `/api/rounds/{id}/analyze/` |
| GET/POST | `/api/prep-plans/` |
| GET/DELETE | `/api/prep-plans/{id}/` |
| POST | `/api/prep-plans/{id}/regenerate/` |
| PUT/PATCH | `/api/prep-tasks/{id}/` (only `done` is writable) |
| GET | `/api/insights/` |
| GET | `/api/subscriptions/plans/` (public), `/current/`, `/usage/`, `/payments/` |
| POST | `/api/subscriptions/checkout/` (`{"plan": "pro_monthly"}`), `/verify/`, `/change-plan/`, `/cancel/` (`{"at_period_end": true}`), `/resume/` |
| POST | `/api/webhooks/razorpay/` (Razorpay only, signature checked) |

Requests over a plan's limit get 429 with `{detail, code: "usage_limit", feature, plan, limit, used, reset_at}`.
