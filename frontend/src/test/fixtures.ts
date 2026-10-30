import type { Quota, Usage } from "@/models/Auth";
import type { CurrentSubscription, Payment, PlansResponse, Price, Subscription, Tier } from "@/models/Billing";

/** Server responses for tests, shaped like the real API's. */

const tier = (code: Tier["code"], overrides: Partial<Tier> = {}): Tier => ({
  code,
  name: { free: "Free", pro: "Pro", pro_plus: "Pro Plus" }[code],
  analyses_per_24h: { free: 2, pro: 15, pro_plus: 50 }[code],
  analyses_fair_use: code === "pro_plus",
  prep_plans_per_24h: { free: 1, pro: 5, pro_plus: 15 }[code],
  ai_available: true,
  ai_model: code === "pro_plus" ? "Better model (Pro-class)" : "Flash",
  priority_queue: code === "pro_plus",
  debriefs_used_for_training: code === "free",
  rule_based_fallback: true,
  usage_tracking: true,
  browser_extension: true,
  ...overrides,
});

export const price = (code: string, overrides: Partial<Price> = {}): Price => {
  const [, tierCode, interval] = code.match(/^(pro_plus|pro)_(monthly|yearly)$/)!;
  const amounts: Record<string, number> = {
    pro_monthly: 19900,
    pro_yearly: 169900,
    pro_plus_monthly: 49900,
    pro_plus_yearly: 399900,
  };
  return {
    code,
    tier: tierCode as Price["tier"],
    interval: interval === "yearly" ? "year" : "month",
    price_paise: amounts[code],
    currency: "INR",
    available: true,
    ...overrides,
  };
};

export const plansResponse = (overrides: Partial<PlansResponse> = {}): PlansResponse => ({
  tiers: [
    { ...tier("free"), prices: [] },
    { ...tier("pro"), prices: [price("pro_monthly"), price("pro_yearly")] },
    { ...tier("pro_plus"), prices: [price("pro_plus_monthly"), price("pro_plus_yearly")] },
  ],
  billing_enabled: true,
  grace_days: 3,
  ...overrides,
});

const quota = (limit: number, used: number, overrides: Partial<Quota> = {}): Quota => ({
  limit,
  used,
  remaining: limit - used,
  next_available_at: used ? "2026-10-31T09:00:00Z" : null,
  fair_use: false,
  ...overrides,
});

export const usage = (plan: Usage["plan"] = "free", overrides: Partial<Usage> = {}): Usage => ({
  plan,
  plan_name: tier(plan).name,
  ai_enabled: true,
  ai_free_tier: plan === "free",
  training_notice: plan === "free",
  ai_model: tier(plan).ai_model,
  priority: plan === "pro_plus",
  analyses: quota(tier(plan).analyses_per_24h!, 1, { fair_use: plan === "pro_plus" }),
  prep_plans: quota(tier(plan).prep_plans_per_24h!, 0),
  ...overrides,
});

export const subscription = (code = "pro_monthly", overrides: Partial<Subscription> = {}): Subscription => ({
  plan: price(code),
  interval: code.endsWith("yearly") ? "year" : "month",
  status: "active",
  status_label: "Active",
  gives_access: true,
  start_at: null,
  current_start: "2026-10-01T00:00:00Z",
  current_end: "2026-11-01T00:00:00Z",
  next_charge_at: "2026-11-01T00:00:00Z",
  ended_at: null,
  cancel_at_period_end: false,
  cancel_requested_at: null,
  scheduled_plan: null,
  scheduled_change_at: null,
  access_until: null,
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

/** The current-subscription response for a free user, or a subscriber to `code`. */
export const current = (code: string | null = null, overrides: Partial<CurrentSubscription> = {}): CurrentSubscription => {
  const plan = code ? price(code).tier : "free";
  const active = code !== null;
  return {
    plan: tier(plan),
    source: active ? "subscription" : "free",
    subscription: active ? subscription(code!) : null,
    upcoming: null,
    actions: {
      subscribe: !active,
      change_plan: active,
      cancel: active,
      cancel_at_period_end: active,
      cancel_upcoming: false,
      resume: false,
      pay: false,
    },
    billing_enabled: true,
    usage: usage(plan),
    ...overrides,
  };
};

export const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 1,
  razorpay_payment_id: "pay_1",
  plan: "pro_monthly",
  amount_paise: 19900,
  currency: "INR",
  status: "captured",
  status_label: "Paid",
  method: "card",
  method_detail: "Visa",
  failure_reason: "",
  paid_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});
