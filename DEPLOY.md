# Deploying on free tiers

| Part | Host | Free tier |
| --- | --- | --- |
| Frontend (Next.js) | [Vercel](https://vercel.com) Hobby | Personal, non-commercial use only |
| API (Django) | [Render](https://render.com) free web service | 512 MB; sleeps after 15 min idle, ~1 min to wake |
| Database | [Neon](https://neon.tech) free Postgres | 0.5 GB, doesn't expire |
| Redis (rate limits) | [Upstash](https://upstash.com) free Redis | Needed with `VERTEX_API_KEY`; optional otherwise |
| Celery | Not needed | Jobs run inline when `CELERY_BROKER_URL` is blank |

Render's own free Postgres is deleted after 30 days, so the database goes on Neon.

## 1. Database (Neon)

1. Create a project. Pick the region closest to the Render region you'll use (e.g. both in Singapore or both in Frankfurt).
2. On the dashboard, open **Connect** and note the host, database, user and password. Use the direct connection, not the pooled (`-pooler`) one: Django keeps its own connections (`CONN_MAX_AGE`).

## 2. Redis (Upstash), for the rate limits

Every new account gets free AI runs. With `VERTEX_API_KEY` set, you pay for them, so the per-IP sign-up limit has to be counted in one shared place. Otherwise each gunicorn worker keeps its own count, and a restart (or the free instance going to sleep) resets it. `manage.py check --deploy` warns about this (`billing.W002`).

Create a free Redis database in Upstash, close to the Render region, and copy its `rediss://` URL for `CACHE_URL`. Without a paid AI key you can skip this.

## 3. API (Render)

1. Push this repo to GitHub (already at `rahul-312/interview-analyzer`).
2. On Render, choose **New > Blueprint** and pick the repo. It reads [render.yaml](render.yaml).
3. Fill in the values it asks for:
   - `ALLOWED_HOSTS`: the service's host, e.g. `interview-analyzer-api.onrender.com` (Render shows it once created; you can set it after the first deploy).
   - `CORS_ALLOWED_ORIGINS`: the Vercel URL from step 4, e.g. `https://interview-analyzer.vercel.app` (no trailing slash). Fill it in once you have it.
   - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: from Neon.
   - `CACHE_URL`: the Upstash URL from step 2, or blank.
   - `GEMINI_API_KEY` / `VERTEX_API_KEY`: optional; with neither, the rule-based analyzer is used. For a paid Gemini key, also change `GEMINI_FREE_TIER` to `false` in the service's Environment tab.
4. Deploy. The build runs `collectstatic` and `migrate`.
5. Check `https://<service>.onrender.com/admin/` loads.

Create an admin user from your own machine, pointed at Neon (the free tier has no shell):

```sh
cd backend
DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... DB_PORT=5432 DB_SSLMODE=require python manage.py createsuperuser
```

## 4. Frontend (Vercel)

1. **Add New > Project**, import the repo, and set **Root Directory** to `frontend`. Vercel detects Next.js.
2. Add the environment variable `NEXT_PUBLIC_API_URL` = `https://<service>.onrender.com/api` (and `NEXT_PUBLIC_EXTENSION_URL` if the extension is published).
3. Deploy, then put the Vercel URL in the API's `CORS_ALLOWED_ORIGINS` on Render. Saving restarts the API.

`NEXT_PUBLIC_*` values are built into the pages, so redeploy the frontend after changing them.

## Things to know

- **Cold starts.** After 15 minutes without requests the API sleeps, and the next request takes about a minute. To avoid that, ping it every 10 minutes with a free monitor (e.g. UptimeRobot on `/admin/login/`). That keeps it awake about 730 hours a month, which fits Render's 750 free hours for one service.
- **Commercial use.** Vercel Hobby doesn't allow commercial projects. Once paid plans are live through Razorpay, move to Vercel Pro, or host the frontend on Netlify's free plan, which allows commercial use.
- **Gemini free tier.** It's fine for a personal deployment. See the README for the limits and data-use notes before opening it up.
- **Billing.** Leave the Razorpay variables blank to keep buying off. To turn it on, follow BILLING.md, "Going live".
- **Security headers.** `render.yaml` turns on the HTTPS redirect and a one-hour HSTS. Once everything works, raise `SECURE_HSTS_SECONDS` to `31536000`.
- **The extension.** In its popup, set the server addresses to the Render API and Vercel URLs. It asks for permission for those https hosts.
