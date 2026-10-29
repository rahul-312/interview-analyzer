# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). The backend, frontend and browser
extension share one version number.

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
