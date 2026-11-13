# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). The backend, frontend and browser
extension share one version number.

## [Unreleased]

### Plans and billing
- Three plans: Free, Pro (₹199/month or ₹1,699/year) and Pro Plus (₹499/month
  or ₹3,999/year), billed as Razorpay subscriptions.
- Per-plan limits on AI round analyses (2, 15, 50) and prep plans (1, 5, 15)
  per rolling 24 hours, enforced on the server for the web app and the
  browser extension alike. Pro Plus shows "Unlimited, fair use", with the
  real allowance stated.
- Pro Plus runs on a better model (`GEMINI_PRO_MODEL`) and a priority Celery
  queue.
- Pricing page with monthly and yearly prices, and a Plans & billing page
  with the current plan, usage, payment history, plan changes, cancellation
  and recovery from failed payments.
- Razorpay webhooks keep subscriptions and payments in sync. Repeated and
  out-of-order events are handled, and `reconcile_subscriptions` catches
  anything missed.
- Free users are told their debriefs may be used for training. Debriefs on
  paid plans are never sent to a free-tier Gemini key and are excluded from
  training.
- Usage-limit responses (429) now include the feature, limit, usage and
  reset time.
- 7-day money-back window: cancelling now within 7 days of a new
  subscription's first payment refunds it in full through Razorpay, once per
  user (`BILLING_REFUND_DAYS`). Add the `refund.*` events to the Razorpay
  webhook and run `migrate`.
- Upgrades on UPI Autopay and eMandate, which Razorpay can't move to another
  plan: the new plan is paid in Checkout, then the old one is cancelled and
  its unused days refunded. The dialog shows the price and estimated refund
  first. Run `migrate`; with a Celery broker, a worker finishes upgrades, and
  `reconcile_subscriptions` retries any left unfinished.

### Voice debriefs
- "Fill in by voice" on the debrief form: record a spoken recap of the round
  (up to 10 minutes) and Gemini writes it up into questions, answers, topics,
  confidence and notes. The draft is merged into the form, keeping anything
  already typed, for the user to check before saving. Shown only when AI is on
  for the user's plan.
- New endpoint `POST /api/rounds/debrief-from-voice/` (multipart `audio`).
  It saves nothing. The AI call runs in the request with no retry waits and a
  timeout of `VOICE_DEBRIEF_TIMEOUT_SECONDS` (default 50), so the app server
  and proxy timeouts must be longer: gunicorn's default of 30 is too short
  (see "Going live" in BILLING.md). Requests without a Content-Length are
  refused. A recording with nothing usable in it is given back.
- Voice debriefs have their own per-plan limit per rolling 24 hours (3, 15,
  40; `FREE_/PRO_/PRO_PLUS_VOICE_DEBRIEFS_PER_24H`), counted like analyses and
  shown in `usage.voice_debriefs`. Failures that cost nothing are given back.
- Recordings are checked by their bytes, not the type the browser claims.
  Uploads over `VOICE_DEBRIEF_MAX_BYTES` (default 14,000,000) are refused from
  the request's Content-Length, before the body is read; also cap request
  bodies at the proxy (nginx `client_max_body_size 15m`).

### Changed
- `/` is now a public home page. Logged-in users still go straight to their
  applications, and the logo on the login and register pages links to it.
- The pricing page is public and prerendered. Logged-out visitors see the
  plans and sign up from there, and anyone picking a paid plan comes back to
  it to pay. The plans API is cached for 60 seconds.
- The free plan now includes 1 prep plan per 24 hours (was 2).
- An admin-set plan on a profile is now a complimentary plan. Users get
  whichever is higher: that plan or their subscription.
- Pro now has limits: 15 AI round analyses and 5 prep plans per 24 hours.
  It was unlimited.
- Pro jobs only use a paid-tier Gemini key (`GEMINI_PAID_API_KEY`, or
  `GEMINI_API_KEY` with `GEMINI_FREE_TIER=false`). Before, they used the
  same key as Free.

### Upgrading
Users whose profile was set to Pro in the admin are affected on deploy:
- They go from unlimited to 15 analyses and 5 prep plans per 24 hours. To
  keep them unlimited in practice, raise `PRO_ANALYSES_PER_24H` and
  `PRO_PREP_PLANS_PER_24H`, or move them to Pro Plus in the admin.
- If the server only has a free-tier Gemini key, they get the rule-based
  engine until `GEMINI_PAID_API_KEY` is set. `python manage.py check`
  warns about this (`billing.W001`).
- Free users get 1 prep plan per 24 hours instead of 2. Set
  `FREE_PREP_PLANS_PER_24H=2` to keep the old limit.

For voice debriefs, run `migrate` (it adds the voice kind to usage runs).

## [1.0.0] - 2026-10-29

The first release of Interview Analyzer: track job applications, debrief each
interview round, get an analysis of what went wrong, and turn recurring weak
spots into a day-by-day prep plan.

### Applications
- Track applications with company, role, job link, source (cold apply,
  referral, recruiter, job board…) and status: Saved, Applied, Screening,
  Interviewing, Offer, Rejected or Withdrawn.
- Saved and applied dates follow the user's own time zone. Moving a job back
  to Saved, or undoing a mistaken Saved, keeps the real applied date.
- Search applications from anywhere in the app, or on the Applications page
  itself.

### Interviews and analysis
- Log each interview round (phone screen, technical, system design,
  behavioral, hiring manager, take-home, onsite) with its interviewer and
  outcome, and write a debrief of how it went.
- Analyze a round to see what went wrong and what to work on. Analysis runs
  in the background with Celery and Redis, or inline when Redis isn't set up.
- With a Gemini API key, analyses use Gemini with structured JSON output.
  Without one, a rule-based analyzer is used. The app tells users when their
  text goes to Gemini, and when free-tier prompts may be used by Google.
- Insights page with charts of recurring weak spots across rounds.

### Prep plans
- Turn weak spots into a day-by-day prep plan, tick off tasks as they're
  done, and regenerate a plan when needed.

### Plans and limits
- The free plan includes 2 analyses and 2 prep plans per 24 hours (set with
  `FREE_ANALYSES_PER_24H` and `FREE_PREP_PLANS_PER_24H`). Runs that fail for
  reasons that aren't the user's fault are refunded.
- A usage badge shows how many runs are left, or "Basic analysis" when AI is
  off.

### Browser extension
- A Chrome extension (also works in Edge and Brave) that adds a **+ Track**
  button to job cards and a **+ Save to Interview Analyzer** button to job
  pages, on any job site or company careers page. Any page can also be saved
  from the toolbar icon.
- Jobs are read the same way on every site: the schema.org `JobPosting`, then
  what's on screen, then the page title. Jobs already saved are marked
  "✓ Saved".
- Sign-in happens only on the extension's own pages, and its tokens are never
  visible to job sites. The extension doesn't run on email, banking, payment
  or password-manager sites.

### Interface
- Sidebar layout with a frosted glass look, and an initials avatar menu for
  the account and signing out.

### Under the hood
- Backend: Django 5.2, Django REST Framework, SimpleJWT, Celery, PostgreSQL.
- Frontend: Next.js 15, TypeScript, Tailwind CSS 4, Recharts.
- Tests for the backend (pytest) and the extension (Node test runner with
  jsdom).

[1.0.0]: https://github.com/rahul-312/interview-analyzer/releases/tag/v1.0.0
