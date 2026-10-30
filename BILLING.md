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
| Paid access | Starts only when Razorpay reports the subscription `active`, through a webhook or a server-side fetch. The browser's checkout callback alone never grants it. |
| Failed renewal (`pending`) | Paid access continues for `BILLING_GRACE_DAYS` (default 3) after the paid period ends, while Razorpay retries the charge. |
| `halted`, `paused`, `cancelled`, `completed`, `expired` | No paid access. |
| `authenticated` | No paid access. The mandate is set up but nothing has been charged yet. |
| Upgrade (higher tier) | Applies at once, using Razorpay `schedule_change_at: now`. Razorpay bills the new plan by its own rules, and no proration is calculated here. Check the amount charged in test mode before going live. |
| Downgrade, or switching monthly/yearly | Applies at the end of the current cycle (`cycle_end`). The current plan stays until then. |
| Plan changes on UPI Autopay or eMandate | Razorpay doesn't allow them. The user cancels at the end of the period and subscribes to the new plan. |
| Cancel at end of period (default) | Access lasts until the period ends, with no grace period after that. |
| Cancel now | Access ends at once. The rest of the period isn't refunded. |
| Undoing a cancellation | Razorpay can't undo one. The user subscribes again instead, and the new subscription starts billing when the current period ends, so nobody pays twice. |
| Recovery | For `pending` and `halted`, the dashboard's **Update payment** opens Razorpay's hosted link to pay again or change card, and Razorpay then reactivates the subscription. For `paused`, **Resume** calls Razorpay's resume API. |
| Complimentary plans | An admin can set `Profile.plan` to give a plan for free. The user gets whichever is higher: that plan or their subscription. |

## Debriefs and training

- **Free.** Every place a debrief is written shows a notice that Free debriefs may be used to train and improve the AI. The flag that drives it is `training_notice` in the usage data.
- **Pro and Pro Plus.** Debriefs are never sent to a Gemini key on Google's free tier, where Google may use prompts. Paid jobs use `GEMINI_PAID_API_KEY`, or `GEMINI_API_KEY` when `GEMINI_FREE_TIER=false`. If neither is set, paid jobs use the rule-based engine instead of falling back to a free-tier key.
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
| `BILLING_CHECKOUT_REUSE_MINUTES` | Repeat checkouts for the same plan within this time reuse the subscription already created. Default 30. |
| `BILLING_THROTTLE_RATE` | Rate limit for each user's billing actions. Default `20/min`. |
| `BILLING_EMAILS` | Set to `true` to send the app's own billing emails as well as Razorpay's. This needs Django's `EMAIL_*` settings. |
| `GEMINI_PRO_MODEL` | The model Pro Plus uses. If blank, it uses `GEMINI_MODEL`. |
| `GEMINI_PAID_API_KEY` | A key on a billing-enabled project, so paid plans can use AI while Free uses a free-tier key. |
| `CELERY_PRIORITY_QUEUE` | The queue for Pro Plus jobs. Default `priority`. |

Without Razorpay keys, the app still runs: plans are shown, but buying is disabled and the billing endpoints return 503.

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
   - Active events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.updated`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.paused`, `subscription.resumed`, `payment.authorized`, `payment.captured`, `payment.failed`.
5. **Reconciliation.** Schedule `python manage.py reconcile_subscriptions` to run hourly, for example with cron or a scheduled task. It fetches every open subscription from Razorpay in case a webhook was missed, and marks checkouts abandoned for more than a day as expired.

### How webhooks are handled

- The `X-Razorpay-Signature` header is checked against the raw request body. Events with a bad signature get 400 and are not stored.
- Each event is stored once, keyed by `X-Razorpay-Event-Id`:
  - A repeat of an event already applied gets 200 and isn't applied again.
  - If applying an event fails, the response is 500 so Razorpay retries it, and the event is kept as `failed`.
  - To retry failed events yourself, run `python manage.py reprocess_webhooks [event_id ...]`.
- Events arrive in any order:
  - A subscription snapshot older than the newest one already applied is skipped.
  - A subscription that has ended never comes back.
  - A payment's status only moves forward, so a late `authorized` can't undo `captured`.
- Stored events have customer contact details, card, UPI and bank details, and notes removed. Payments keep only the method and card network.
- Events about subscriptions this app didn't create (for example, ones made in the Dashboard) are ignored.

### Worker for the priority queue

Pro Plus jobs go to the `priority` queue. Run a worker that serves it alongside the normal one. On Windows, add `--pool=solo`.

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
8. **Webhook repeats.** Re-send a delivered webhook from the Dashboard. No duplicate payment appears.
9. **Extension.** The extension doesn't start AI jobs itself. It signs in with the same JWT and calls the same API, so any AI request made with its token gets the same plan and limits. `test_extension_gets_the_same_limits_as_the_web_app` covers this.

## Going live

1. Switch to live keys, a live webhook (with its own secret) and live plans (run `setup_razorpay_plans` against the live database).
2. Serve the API over HTTPS. Razorpay only sends webhooks to public HTTPS URLs.
3. Set `DEBUG=0`, a real `SECRET_KEY`, `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`.
4. Run `python manage.py migrate`. This adds the billing tables, seeds the plans, and adds the run-tier and debrief training fields.
5. Start the Celery workers for both queues, and schedule `reconcile_subscriptions`.
6. Set `GEMINI_PAID_API_KEY` (or a paid `GEMINI_API_KEY` with `GEMINI_FREE_TIER=false`). Without one, paid users get the rule-based engine.
7. Keep an eye on `WebhookEvent` rows with status `failed` in the admin.
