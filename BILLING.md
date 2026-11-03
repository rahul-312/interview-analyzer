# Plans and billing

Interview Analyzer has three plans. Paid plans are Razorpay subscriptions. Everything that decides what a user may do (their plan, limits, AI model, queue, and where their debriefs may go) is worked out on the server. The frontend and the browser extension only display it.

## Plans

| | Free | Pro | Pro Plus |
|---|---|---|---|
| Monthly | ₹0 | ₹199 | ₹499 |
| Yearly | — | ₹1,699 | ₹3,999 |
| AI round analyses / 24 h | 2 | 15 | 50, shown as "Unlimited, fair use" |
| AI prep plans / 24 h | 1 | 5 | 15 |
| AI model | Flash (`GEMINI_MODEL`) | Flash | Better model (`GEMINI_PRO_MODEL`) |
| Queue | Normal | Normal | Priority |
| Debriefs used for training | Yes, and the app says so | No | No |
| Rule-based fallback, usage tracking, browser extension | Yes | Yes | Yes |

Where these are defined:

- `backend/billing/tiers.py` lists what each plan includes. The usage limits, the plans API and the pricing page all read from it.
- The limits can be changed per deployment with `FREE_/PRO_/PRO_PLUS_ANALYSES_PER_24H` and `..._PREP_PLANS_PER_24H`.
- Prices and Razorpay plan IDs are rows in the `SubscriptionPlan` table. A data migration adds the four paid plans.

**Fair use on Pro Plus.** The pricing page says "Unlimited, fair use" and spells out the real limit underneath: 50 AI round analyses in any rolling 24 hours. The server enforces that limit like any other.

## Policies

| Policy | What happens |
|---|---|
| Usage window | A rolling 24 hours. Each run frees up 24 hours after it started. |
| What counts as a run | A run counts when it starts. It's given back if it fails for a reason that isn't the user's: nothing reached the AI, which is always given back, or our side failed after the AI call, which is given back at most `BILLED_REFUNDS_PER_24H` times. Refusals and cut-off replies caused by the user's own text still count. A second request while a run is queued or running gets 409 and counts nothing. The web app and the extension use the same endpoints, so they share the same counts. |
| At the limit | 429 with `{detail, code: "usage_limit", feature, plan, limit, used, reset_at}`. A debrief is still saved and can be analysed later. |
| New users | Start on Free. |
| One subscription at a time | A new checkout is refused while another subscription is running, scheduled to start, or waiting for a failed payment or a resume. The only exception is a subscription cancelled at the end of its period, which a new one can follow. Starting a checkout cancels, at Razorpay, any earlier checkout that wasn't completed, so only one can ever be paid. |
| Paid plans without paid-tier AI | Paid plans are only sold when they can use Gemini, which needs `GEMINI_PAID_API_KEY` or a paid `GEMINI_API_KEY`. Without one, the pricing page shows the rule-based engine and the plans as unavailable, checkout refuses them, and `manage.py check` warns (`billing.W001`). |
| Paid access | Starts only when Razorpay reports the subscription `active`, through a webhook or a server-side fetch. The browser's checkout callback alone never grants it. |
| Failed renewal (`pending`) | Paid access continues for `BILLING_GRACE_DAYS` (default 3) after the paid period ends, while Razorpay retries the charge. |
| `halted`, `paused`, `cancelled`, `completed`, `expired` | No paid access. |
| `authenticated` | No paid access. The mandate is set up but nothing has been charged yet. |
| Upgrade (higher tier) | Applies at once, using Razorpay `schedule_change_at: now`. Razorpay bills the new plan by its own rules, and no proration is calculated here. Check the amount charged in test mode before going live. |
| Downgrade, or switching monthly/yearly | Applies at the end of the current cycle (`cycle_end`). The current plan stays until then. |
| Upgrade on UPI Autopay or eMandate | Razorpay can't move these to another plan, so the upgrade buys a **replacement** subscription that starts now. The confirm dialog shows the price and the estimated credit (`GET /api/subscriptions/upgrade-quote/`). The current plan isn't touched until the new one is paid and `active`. Then `finish_replacement` (a Celery task, retried by `reconcile_subscriptions`): fetches the old subscription from Razorpay; decides the credit once and saves it; cancels the old one now; and only then refunds the credit to the payment for its current period. The credit is the unused part of that payment, counted to the second from when the new plan started, in whole paise. It's pro-rata even inside the old plan's money-back window: a full refund there, plus the new plan's own window, would let one person refund two plans in full. If the old plan renewed before the upgrade was recorded, the period used is the one the upgrade fell in, from its payment to the renewal. If the latest payment before the upgrade paid for a period never seen here (renewals missed), the credit isn't worked out: the upgrade is marked **Needs attention** to be credited by hand, and the upgrade email says we'll be in touch. A plan whose last period ran out before the upgrade without being renewed (a failed renewal, or the grace period) has nothing unused, so gets no credit. Below ₹1 nothing is refunded. A renewal the old plan charged after the upgrade is refunded in full. If the old plan had ended before the upgrade was paid, there's no credit. If Razorpay won't cancel it now: one already set to end at period end is left to end and still credited; any other is marked **Needs attention** in the admin (`replacement_status`, `replacement_error`) and not refunded. An upgrade credit doesn't use up the money-back window, so the new plan has its own. A checkout given up on as abandoned that Razorpay says was paid after another upgrade went ahead is marked **Needs attention**, not finished. An upgrade whose credit would be on a payment more than 180 days old (Razorpay's refund limit: confirm it in test mode) is refused before anything is charged (409 `upgrade_at_renewal`); the user can cancel at period end and subscribe to follow instead. An abandoned upgrade checkout expires like any other and doesn't block another. |
| Downgrades and interval switches on UPI Autopay or eMandate | Razorpay doesn't allow them. The user cancels at the end of the period and subscribes to the new plan. |
| Cancel at end of period (default) | Access lasts until the period ends, with no grace period after that. |
| Cancel now | Access ends at once. Outside the money-back window, the rest of the period isn't refunded. |
| Money-back window | Cancelling now within `BILLING_REFUND_DAYS` (default 7) of a subscription's first payment refunds everything paid for it, in full (an upgrade charge too), and access ends at once. Only an active subscription qualifies, and only once per user: any earlier refund, including one made in the Razorpay Dashboard, uses it up. Renewals never qualify, since the window is counted from the first payment. Cancelling at period end gives the refund up: that choice is final, and it's what lets a new plan be bought to follow it. The dialog sends `expect_refund` with a refund it showed, so if the window closed while it was open the server cancels nothing (409 `refund_window_closed`). Partial refunds made in the Dashboard aren't tracked and don't use up the window. The pricing page, the cancel dialog and the cancellation email state the policy. |
| Refunds | The cancellation (or the old plan's cancellation, for an upgrade credit) is saved first and the payments are marked `requested`, then refunded at Razorpay (`speed: normal`, which takes 5–7 working days). A money-back refund asks for the payment's full amount; an upgrade credit for part of it (`refund_amount_paise`), which leaves the payment "Paid". Each refund carries our ID for it (`refund_op_id`) as its receipt and in its notes. Before refunding, Razorpay is asked whether the payment already has this refund, by that ID or (for a full refund) by amount. Only the attempt that claims the payment (`requested` → `sending`) asks Razorpay for the refund, so two attempts at once can't both make one; Razorpay also refuses to refund more than was paid. When Razorpay doesn't answer (or answers 5xx), the refund may have been made, so the claim is kept: after 10 minutes `reconcile_subscriptions` asks Razorpay again before retrying. No database lock is held during these calls. The cancellation email is sent after the refund is attempted, and only mentions a refund that hasn't failed. A refund Razorpay can't be reached for, or refuses with any other status (429 rate limit, 401/403 bad keys, 5xx), is retried by `reconcile_subscriptions`, which leaves a refund alone for its first 10 minutes so it doesn't race the cancel making it. A refund still not made after an hour, or still processing at Razorpay after 10 days, is logged as an error on every run ("refund(s) stuck", with the first few payment IDs), since the user is being told it's on its way. Not made usually means bad Razorpay keys. A refund Razorpay **refuses** with 400 or 422 (for example, because a partial refund in the Dashboard left less than the full amount) or that **fails** at Razorpay is logged as an error, shown to the user as "Refund failed, contact support" and not retried: refund it from the Dashboard. Filter payments by refund status in the admin to find them. Razorpay keeps its fee on refunded payments. |
| Undoing a cancellation | Razorpay can't undo one. The user subscribes again instead, and the new subscription starts billing when the current period ends, so nobody pays twice. |
| Cancelling the new subscription | Until it starts, the dashboard's **Cancel upcoming subscription** cancels it straight away. Nothing has been charged for it. |
| Abandoned checkouts | A checkout's payment link expires at Razorpay after a day (`expire_by`). `reconcile_subscriptions` also cancels any still-unpaid checkout older than that at Razorpay and marks it expired. If Razorpay says it was paid after all, Razorpay's state wins and the user gets the plan. |
| Recovery | For `pending` and `halted`, the dashboard's **Update payment** opens Razorpay's hosted link to pay again or change card, and Razorpay then reactivates the subscription. For `paused`, **Resume** calls Razorpay's resume API. |
| Complimentary plans | An admin can set `Profile.plan` to give a plan for free. The user gets whichever is higher: that plan or their subscription. |

## Debriefs and training

- **Free.** Every place a debrief is written shows a notice that Free debriefs may be used to train and improve the AI. The flag that drives it is `training_notice` in the usage data.
- **Pro and Pro Plus.** Debriefs are never sent to a Gemini key on Google's free tier, where Google may use prompts. Paid jobs use `GEMINI_PAID_API_KEY`, or `GEMINI_API_KEY` when `GEMINI_FREE_TIER=false`. If neither is set, paid plans aren't sold, and anyone already on one, including a complimentary plan, gets the rule-based engine instead of a free-tier key.
- **Training pipelines** must select debriefs only through `billing.training.training_eligible_debriefs()`. A debrief qualifies only if:
  1. every version of it was written on Free (`Debrief.training_eligible`, which is internal and not in the API), and
  2. its author is on Free now.
- **Earlier debriefs when a user changes plan.**
  - Upgrading excludes all of a user's debriefs from then on, including ones written on Free. Anything already used before the upgrade can't be taken back.
  - Downgrading doesn't make debriefs written on a paid plan eligible. Only new ones are.
  - Debriefs written before this feature existed are not eligible.
- The rule depends on the plan only. If other privacy or retention rules apply, such as a deletion request, they must be applied as well.

## Environment variables (`backend/.env`)

| Variable | Purpose |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | API keys. Use `rzp_test_...` keys outside production. The secret never leaves the server: Checkout only receives the key ID and a subscription ID. |
| `RAZORPAY_WEBHOOK_SECRET` | The secret entered when creating the webhook in the Razorpay Dashboard. |
| `RAZORPAY_PLAN_PRO_MONTHLY` and the other three plans (optional) | Existing Razorpay plan IDs for `setup_razorpay_plans` to link, instead of creating new plans. |
| `RAZORPAY_MONTHLY_TOTAL_COUNT`, `RAZORPAY_YEARLY_TOTAL_COUNT` | Billing cycles before a subscription completes. Razorpay requires a total. Defaults are 120 and 10. |
| `BILLING_GRACE_DAYS` | Grace period for failed renewals. Default 3. |
| `BILLING_REFUND_DAYS` | The money-back window, in days from a subscription's first payment. Default 7. `0` turns it off. |
| `BILLING_CHECKOUT_REUSE_MINUTES` | Repeat checkouts for the same plan within this time reuse the subscription already created. Default 30. |
| `BILLING_THROTTLE_RATE` | Rate limit for each user's billing actions. Default `20/min`. |
| `SIGNUP_THROTTLE_RATE` | Sign-ups allowed per IP address, since every new account gets free AI runs. Default `10/hour`. Only accounts actually created count, not rejected forms. Needs `CACHE_URL` to count across processes, and `NUM_PROXIES` to see the real IP. |
| `SIGNUP_ATTEMPT_THROTTLE_RATE` | All register requests per IP, including rejected ones, so usernames can't be probed without limit. Default `60/min`. |
| `NUM_PROXIES` | Reverse proxies in front of the API, such as nginx or a load balancer. Default `0`. Set it to the real number (usually `1`) so the rate limits read the client's IP from `X-Forwarded-For`. Too high and clients can fake their IP with that header; too low and everyone shares the proxy's IP, and with it one sign-up limit. The server logs a warning if a request arrives with `X-Forwarded-For` while it's `0`. |
| `BILLING_EMAILS` | Set to `true` to send the app's own billing emails as well as Razorpay's. This needs Django's `EMAIL_*` settings. |
| `GEMINI_PRO_MODEL` | The model Pro Plus uses. If blank, it uses `GEMINI_MODEL`. |
| `GEMINI_PAID_API_KEY` | A key on a billing-enabled project, so paid plans can use AI while Free uses a free-tier key. |
| `VERTEX_API_KEY` | A Vertex AI key on a Google Cloud project with billing. When set, every plan, Free included, uses it instead of the keys above. It's a paid tier, so paid plans are sold and the Google free-tier notice isn't shown (the app's own Free-plan training notice still is). There's no fallback: while it's set the Gemini keys are never used, so a bad key, a billing suspension or a Vertex outage stops AI for every plan (jobs fail without counting). Free accounts get AI on this billed key, so set a budget alert on the project and restrict the key to the Vertex AI API. |
| `CELERY_PRIORITY_QUEUE` | The queue for Pro Plus jobs. Default `priority`. A worker started without `-Q` serves it as well as the normal queue. |
| `CACHE_URL` | A shared cache such as `redis://localhost:6379/1`. The billing rate limit counts in it, so set it whenever more than one process serves the API. Without it, each process counts separately. |

Without Razorpay keys, the app still runs: plans are shown, but buying is disabled and the billing endpoints return 503. That includes cancelling, so don't remove the keys while anyone has a subscription.

## Setting up Razorpay

Set this up separately for test mode and live mode. They have different keys, plans and webhooks.

1. **API keys.** In the Razorpay Dashboard, go to **Account & Settings → API Keys** and generate keys. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. **Subscriptions.** Make sure Subscriptions is enabled for the account.
3. **Plans.** Run `python manage.py setup_razorpay_plans`, or `--dry-run` first to see what it would do. It creates the four plans in Razorpay (monthly or yearly, interval 1, in INR) and saves their IDs. To use plans that already exist instead, set `RAZORPAY_PLAN_<CODE>` first.
   - Razorpay plans can't be edited. To change a price: edit `price_paise` in the admin, clear `razorpay_plan_id`, then run the command again.
   - Existing subscribers keep their old price.
4. **Webhook.** Go to **Account & Settings → Webhooks → Add new webhook**.
   - URL: `https://<your-api-host>/api/webhooks/razorpay/`.
   - Secret: the value of `RAZORPAY_WEBHOOK_SECRET`.
   - Active events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.updated`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, `subscription.resumed`, `payment.authorized`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`.
5. **Reconciliation.** Schedule `python manage.py reconcile_subscriptions` to run hourly, for example with cron or a scheduled task. It fetches every open subscription from Razorpay in case a webhook was missed. Checkouts still not completed after a day are cancelled at Razorpay and marked expired. Upgrades whose old plan isn't cancelled or credited yet are finished, and any left over an hour, or needing attention, are logged as errors ("upgrade(s) unfinished"): the old plan may still renew. Refunds not yet made are made, and ones still processing are synced.

### How webhooks are handled

- The `X-Razorpay-Signature` header is checked against the raw request body. Events with a bad signature get 400 and are not stored.
- Each event is stored once, keyed by `X-Razorpay-Event-Id`. That header isn't signed, so a body already received under another ID counts as a replay and isn't applied again.
  - A repeat of an event already applied gets 200 and isn't applied again.
  - If applying an event fails, the response is 500 so Razorpay retries it, and the event is kept as `failed`.
  - To retry failed events yourself, run `python manage.py reprocess_webhooks [event_id ...]`.
- Events arrive in any order:
  - A subscription snapshot older than the newest one already applied is skipped. If it disagrees with the state applied, the subscription is fetched from Razorpay, since the two clocks can differ.
  - A subscription that has ended never comes back.
  - A payment's status only moves forward, so a late `authorized` can't undo `captured`.
- Stored events have customer contact details, card, UPI and bank details, and notes removed. Payments keep only the method and card network.
- Events about subscriptions this app didn't create (for example, ones made in the Dashboard) are ignored.

### Worker for the priority queue

Pro Plus jobs go to the `priority` queue. A worker started without `-Q`, like the one in the README, serves both queues, so nothing is left waiting. For a real priority lane, run a second worker that serves only Pro Plus. On Windows, add `--pool=solo`.

```powershell
celery -A config worker -Q priority -l info -n priority@%h      # Pro Plus only
celery -A config worker -Q priority,celery -l info -n default@%h
```

Without a broker, jobs run inline and the queue makes no difference.

## Testing in Razorpay test mode

Run the automated tests against a fake Razorpay:

```powershell
cd backend;  .venv\Scripts\python -m pytest billing
cd frontend; npm test
```

Before going live, check these by hand in test mode with test keys. To receive webhooks locally, use a tunnel such as ngrok or cloudflared.

1. **Purchase.** Subscribe to Pro monthly with a test card. The dashboard shows Pro, the next billing date and a "Paid" payment. The Dashboard's webhook log shows `subscription.activated` and `subscription.charged` delivered with 200.
2. **The other three plans.** Repeat the purchase for Pro yearly, Pro Plus monthly and Pro Plus yearly.
3. **Failed payment.** Use a failing test card. Checkout shows the error and the plan stays Free.
4. **Renewal.** Use Razorpay's test-mode tools to charge or advance the subscription. A second payment appears and the period moves forward.
5. **Failed renewal and recovery.** Make a renewal fail. The status becomes "Payment failed, retrying", the grace message appears, and **Update payment** opens Razorpay. Pay, and the plan is active again.
6. **Upgrade, then downgrade.** Upgrade Pro to Pro Plus and check that it applies at once, and check the amount Razorpay charges. Then downgrade and check that the change is scheduled for the end of the cycle.
7. **Cancellation.** Cancel at the end of the period. Access lasts until that date, then becomes Free when `subscription.cancelled` arrives.
7a. **Upgrade on UPI Autopay.** Subscribe to Pro monthly with UPI Autopay, then upgrade to Pro Plus. Check:
    - The dialog shows ₹499 and an estimated credit.
    - Checkout asks for a new mandate.
    - Pro is untouched until the payment goes through. Then it's cancelled at once.
    - A partial refund of about the unused days appears on the Pro payment, with our `receipt`, and the payment stays "Paid".
    - `fetch_refunds` returns that `receipt` and the `notes`.

    Repeat with eMandate. Also check:
    - `cancel_at_cycle_end=0` on a subscription already set to end at period end.
    - What Razorpay returns for a refund on a payment past its refund age limit.
    - The order activation, payment and charged webhooks arrive in.
8. **Money-back refund.** Subscribe, then choose **Cancel now** within 7 days. The dialog offers the full amount, access ends, and the payment shows "Refund on the way". The Dashboard shows the refund, and `refund.processed` turns the payment to "Refunded". Subscribe and cancel now again: no second refund is offered. Also send two full refund requests for one payment back to back (for example with curl): Razorpay must refuse the second while the first is still processing, since that's what stops a double refund.
9. **Webhook repeats.** Re-send a delivered webhook from the Dashboard. No duplicate payment appears.
10. **Extension.** The extension doesn't start AI jobs itself. It signs in with the same JWT and calls the same API, so any AI request made with its token gets the same plan and limits. `test_extension_gets_the_same_limits_as_the_web_app` covers this.

## Going live

1. Switch to live keys, a live webhook (with its own secret) and live plans (run `setup_razorpay_plans` against the live database).
2. Serve the API over HTTPS. Razorpay only sends webhooks to public HTTPS URLs.
3. Set `DEBUG=0`, a real `SECRET_KEY`, `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`, `CACHE_URL` if more than one process serves the API, and `NUM_PROXIES` if it's behind a reverse proxy.
4. Run `python manage.py migrate`. This adds the billing tables, seeds the plans, and adds the run-tier and debrief training fields.
5. Start the Celery workers for both queues, and schedule `reconcile_subscriptions`.
6. Set `GEMINI_PAID_API_KEY` (or a paid `GEMINI_API_KEY` with `GEMINI_FREE_TIER=false`). Without one, paid plans aren't sold and anyone already on one gets the rule-based engine. `python manage.py check` warns about this.
7. Decide what existing complimentary Pro users get: see "Upgrading" in the CHANGELOG.
8. Keep an eye on `WebhookEvent` rows with status `failed` in the admin.
