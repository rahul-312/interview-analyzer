import type { Plan, Usage } from "./Auth";

export type Interval = "month" | "year";

export type SubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "paused"
  | "cancelled"
  | "completed"
  | "expired";

/** One way to pay for a paid tier. Amounts are in paise (₹199 = 19900). */
export interface Price {
  code: string;
  tier: Plan;
  interval: Interval;
  price_paise: number;
  currency: string;
  /** False until the plan is set up in Razorpay. */
  available: boolean;
}

/** What a plan includes, straight from the server's plan definitions. */
export interface Tier {
  code: Plan;
  name: string;
  /** null = unlimited. With `analyses_fair_use`, this is the fair-use allowance. */
  analyses_per_24h: number | null;
  analyses_fair_use: boolean;
  prep_plans_per_24h: number | null;
  /** False when this server has no Gemini key this plan may use; `ai_model` then names the rule-based engine. */
  ai_available: boolean;
  ai_model: string;
  priority_queue: boolean;
  debriefs_used_for_training: boolean;
  rule_based_fallback: boolean;
  usage_tracking: boolean;
  browser_extension: boolean;
}

export interface TierWithPrices extends Tier {
  prices: Price[];
}

export interface PlansResponse {
  tiers: TierWithPrices[];
  billing_enabled: boolean;
  grace_days: number;
  /** Money-back window: days after a first payment that cancelling now refunds it. 0 = none. */
  refund_days: number;
}

export interface Subscription {
  plan: Price;
  interval: Interval;
  status: SubscriptionStatus;
  status_label: string;
  gives_access: boolean;
  start_at: string | null;
  current_start: string | null;
  current_end: string | null;
  next_charge_at: string | null;
  ended_at: string | null;
  cancel_at_period_end: boolean;
  cancel_requested_at: string | null;
  scheduled_plan: Price | null;
  scheduled_change_at: string | null;
  /** When paid access ends; null while it renews normally. */
  access_until: string | null;
  created_at: string;
}

export interface SubscriptionActions {
  subscribe: boolean;
  change_plan: boolean;
  cancel: boolean;
  cancel_at_period_end: boolean;
  /** A subscription bought to start when the current one ends can be cancelled before it starts. */
  cancel_upcoming: boolean;
  resume: boolean;
  /** A charge failed: pay again or change card through Razorpay's link. */
  pay: boolean;
}

export interface CurrentSubscription {
  plan: Tier;
  source: "subscription" | "complimentary" | "free";
  subscription: Subscription | null;
  /** Bought to take over when a subscription cancelled at period end runs out. */
  upcoming: Subscription | null;
  actions: SubscriptionActions;
  /** Set while cancelling now would refund the subscription in full. */
  refund: RefundOffer | null;
  refund_days: number;
  billing_enabled: boolean;
  usage: Usage;
  /** Only after change-plan: when the change applies, or "checkout" for an upgrade paid in Checkout first. */
  change?: "now" | "cycle_end" | "checkout";
  /** Only after change-plan with change "checkout": what Checkout needs to pay for the upgrade. */
  checkout?: CheckoutConfig;
  /** Only after cancel: what the cancellation refunded. */
  refunded?: Pick<RefundOffer, "amount_paise" | "currency"> | null;
  /** Only after cancel: Razorpay refused a refund straight away, so support has to make it. */
  refund_failed?: boolean;
  /** Only after resume: Razorpay's link to pay a failed charge. */
  payment_url?: string | null;
}

export interface Payment {
  id: number;
  razorpay_payment_id: string;
  plan: string | null;
  amount_paise: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  status_label: string;
  method: string;
  method_detail: string;
  failure_reason: string;
  /** "" when not refunded. "requested", "sending" and "pending" are on the way. */
  refund_status: "" | "requested" | "sending" | "pending" | "processed" | "failed";
  /** "upgrade_credit": the unused days of a plan an upgrade replaced. */
  refund_reason: "" | "money_back" | "upgrade_credit";
  /** What the refund is for: all of amount_paise, or part of it. null without a refund. */
  refund_paise: number | null;
  paid_at: string | null;
  created_at: string;
}

/**
 * What upgrading would do. "native_change": Razorpay moves the subscription to the new plan and
 * bills it by its own rules. "replacement" (UPI Autopay, eMandate): the new plan is paid in
 * Checkout, then about `credit_paise` of the current one comes back.
 */
export interface UpgradeQuote {
  strategy: "native_change" | "replacement";
  plan: Price;
  /** False when the current plan's unused days couldn't be refunded ("too_old"). */
  available: boolean;
  charge_paise: number | null;
  /** An estimate: the server works out the credit when the new plan starts. */
  credit_paise: number;
  credit_reason: "" | "below_minimum" | "no_payment" | "too_old";
  currency: string;
}

/** What cancelling now would refund, inside the money-back window. */
export interface RefundOffer {
  amount_paise: number;
  currency: string;
  /** The window closes then. */
  until: string;
}

/** What the server returns for Razorpay Checkout. Never contains a secret. */
export interface CheckoutConfig {
  key_id: string;
  subscription_id: string;
  plan: string;
  name: string;
  description: string;
  starts_at: string | null;
  prefill: { name: string; email: string };
}

/** Checkout's success response, sent to the server to verify. */
export interface CheckoutResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}
