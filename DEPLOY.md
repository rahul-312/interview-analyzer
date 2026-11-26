# Deploying on free tiers

| Part | Host | Free tier |
| --- | --- | --- |
| Frontend (Next.js) | [Vercel](https://vercel.com) Hobby | Personal, non-commercial use only |
| API (Django) | [Render](https://render.com) Starter web service ($7/month) | 512 MB; always on. The free plan also works, with `BILLING_EMAILS=false` (it blocks outgoing email) and migrations moved into the build command (it has no pre-deploy command); it sleeps after 15 min idle |
| Database | [Neon](https://neon.tech) free Postgres | 1 GB; scales to zero when idle, doesn't expire |
| Redis (rate limits) | [Upstash](https://upstash.com) free Redis | Needed with `VERTEX_API_KEY`; optional otherwise |
| Celery | Not needed | Jobs run inline when `CELERY_BROKER_URL` is blank |

Render's own free Postgres is deleted after 30 days, so the database goes on Neon.

## 1. Database (Neon)

1. Create a project (Postgres 16). Pick the region closest to the Render region you'll use (e.g. both in Singapore or both in Frankfurt).
2. Get its two connection strings, either with the Neon CLI from the repo root (`neon init`, then `neon env pull`, which writes them to `.env.local`) or from **Connect** in the console, once with pooling on and once off:
   - `DATABASE_URL`: pooled (`-pooler` in the host). The app's queries use it.
   - `DATABASE_URL_UNPOOLED`: direct. Migrations use it, since the pooler runs in transaction mode.

Django reads `DATABASE_URL` when it's set, in place of the `DB_*` settings. It turns off server-side cursors on a pooled URL, as a transaction-mode pooler requires. The `.env.local` at the repo root isn't read by Django, so local development keeps using `backend/.env`.

## 2. Redis (Upstash), for the rate limits

Every new account gets free AI runs. With `VERTEX_API_KEY` set, you pay for them, so the per-IP sign-up limit has to be counted in one shared place. Otherwise each gunicorn worker keeps its own count, and a restart (or the free instance going to sleep) resets it. `manage.py check --deploy` warns about this (`billing.W002`).

Create a free Redis database in Upstash, close to the Render region, and copy its `rediss://` URL for `CACHE_URL`. Without a paid AI key you can skip this.

## 3. API (Render)

1. Push this repo to GitHub (already at `rahul-312/interview-analyzer`).
2. On Render, choose **New > Blueprint** and pick the repo. It reads [render.yaml](render.yaml).
3. Fill in the values it asks for:
   - `ALLOWED_HOSTS`: the service's host, e.g. `interview-analyzer-api.onrender.com` (Render shows it once created; you can set it after the first deploy).
   - `CORS_ALLOWED_ORIGINS`: the Vercel URL from step 4, e.g. `https://interview-analyzer.vercel.app` (no trailing slash). Fill it in once you have it.
   - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`: from Neon.
   - `CACHE_URL`: the Upstash URL from step 2, or blank.
   - `GEMINI_API_KEY` / `VERTEX_API_KEY`: optional; with neither, the rule-based analyzer is used. For a paid Gemini key, also change `GEMINI_FREE_TIER` to `false` in the service's Environment tab.
   - `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`: the Gmail address and an app password (see "Email" below).
4. Deploy. The build runs `collectstatic`, then the pre-deploy command runs `migrate` over `DATABASE_URL_UNPOOLED`.
5. Check `https://<service>.onrender.com/admin/` loads.

Create an admin user with `python manage.py createsuperuser` in the service's Shell, or (on the free plan, which has no shell) from your own machine, pointed at Neon. In PowerShell, from `backend/`, with the direct URL:

```powershell
$env:DATABASE_URL = "<DATABASE_URL_UNPOOLED>"
.venv\Scripts\python.exe manage.py createsuperuser
Remove-Item Env:DATABASE_URL   # or later commands in this terminal also use Neon
```

If that fails with `failed to resolve host ... neon.tech`, your network's DNS server is refusing Neon's hostnames (some ISP routers do). Switch the computer's DNS to 1.1.1.1 or 8.8.8.8 and try again. Render and Vercel aren't affected.

### Email

The API sends email through Gmail SMTP: billing emails (`BILLING_EMAILS`) and anything else Django sends.

1. Turn on 2-Step Verification for the Google account.
2. Create an app password at Google Account > Security > App passwords (myaccount.google.com/apppasswords). Google shows it once.
3. On Render, set `EMAIL_HOST_USER` to the Gmail address and `EMAIL_HOST_PASSWORD` to the app password. Never use the account's own password.
4. Check it from the service's Shell: `python manage.py sendtestemail you@example.com`.

Render's free plan blocks outgoing traffic on ports 25, 465 and 587, so sending only works on Starter or above. Gmail allows about 500 emails a day, and mail comes from the Gmail address. Without `EMAIL_HOST`, nothing is sent, and `manage.py check` warns if billing emails are on without a mail server or its login (`billing.W003`). Port 465 (SSL) works as well as 587 (STARTTLS).

## 4. Frontend (Vercel)

1. **Add New > Project**, import the repo, and set **Root Directory** to `frontend`. Vercel detects Next.js.
2. Add the environment variable `NEXT_PUBLIC_API_URL` = `https://<service>.onrender.com/api` (and `NEXT_PUBLIC_EXTENSION_URL` if the extension is published).
   Also add the contact details for the legal pages: `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_EMAIL`, `NEXT_PUBLIC_LEGAL_PHONE` and `NEXT_PUBLIC_LEGAL_ADDRESS` (see [frontend/.env.example](frontend/.env.example)). They must match the Razorpay account, and a production build fails without them, on any host.
3. Deploy, then put the Vercel URL in the API's `CORS_ALLOWED_ORIGINS` on Render. Saving restarts the API.

`NEXT_PUBLIC_*` values are built into the pages, so redeploy the frontend after changing them.

## Things to know

- **Cold starts (free plan only).** After 15 minutes without requests the API sleeps, and the next request takes about a minute. To avoid that, ping it every 10 minutes with a free monitor (e.g. UptimeRobot on `/admin/login/`). That keeps it awake about 730 hours a month, which fits Render's 750 free hours for one service.
- **Commercial use.** Vercel Hobby doesn't allow commercial projects. Once paid plans are live through Razorpay, move to Vercel Pro, or host the frontend on Netlify's free plan, which allows commercial use.
- **Gemini free tier.** It's fine for a personal deployment. See the README for the limits and data-use notes before opening it up.
- **Tester accounts.** Each tester can run up to `TESTER_JOBS_PER_24H` (default 25) of each kind of AI job a day. On a free-tier key, testers on Free use the same daily quota as every Free user, so a busy tester can make everyone's analyses fail until it resets. Keep the cap low, and use fake data in demos: Free debriefs, testers' included, may be used for training.
- **Billing.** Leave the Razorpay variables blank to keep buying off. To turn it on, follow BILLING.md, "Going live".
- **Security headers.** `render.yaml` turns on the HTTPS redirect and a one-hour HSTS. Once everything works, raise `SECURE_HSTS_SECONDS` to `31536000`.
- **The extension.** In its popup, set the server addresses to the Render API and Vercel URLs. It asks for permission for those https hosts.
