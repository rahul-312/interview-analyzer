import type { Quota } from "@/models/Auth";
import type { CurrentSubscription, Interval, Price, Tier } from "@/models/Billing";
import { formatDate, planLabel } from "./format";

/** 19900 → "₹199", 169900 → "₹1,699". */
export function formatPrice(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export const intervalLabel = (interval: Interval) => (interval === "year" ? "year" : "month");

/** "₹1,699/year" for a price. */
export const priceLabel = (price: Pick<Price, "price_paise" | "currency" | "interval">) =>
  `${formatPrice(price.price_paise, price.currency)}/${intervalLabel(price.interval)}`;

/** A yearly price as a monthly figure, for comparing: 169900 → "₹142/month". */
export const perMonth = (price: Price) => `${formatPrice(Math.round(price.price_paise / 12 / 100) * 100)}/month`;

/** The pricing page's line for a plan's analyses: "2 per 24 hours", or "Unlimited, fair use" on Pro Plus. */
export function allowanceText(limit: number | null, fairUse = false): string {
  if (fairUse) return "Unlimited, fair use";
  if (limit === null) return "Unlimited";
  return `${limit} per 24 hours`;
}

/** The fair-use policy, stated with the allowance the server actually enforces. */
export const fairUseNote = (tier: Tier) =>
  `Fair use: up to ${tier.analyses_per_24h} AI round analyses in any rolling 24 hours. Past that, debriefs are still saved and can be analysed once one frees up.`;

/** "1/2 left", or "Unlimited, fair use" for Pro Plus analyses. */
export function quotaText(quota: Quota): string {
  if (quota.fair_use) return "Unlimited, fair use";
  if (quota.limit === null) return "Unlimited";
  return `${quota.remaining ?? 0}/${quota.limit} left`;
}

/**
 * The one message the dashboard leads with about the subscription's state, or null when there's
 * nothing to say. `tone` picks the colour.
 */
export function subscriptionNotice(current: CurrentSubscription): { tone: "info" | "warn" | "error"; text: string } | null {
  const sub = current.subscription;
  if (!sub) return null;
  if (sub.status === "pending") {
    return {
      tone: "warn",
      text: `Your last payment failed and Razorpay is retrying it. You keep ${planLabel(sub.plan.tier)}${
        sub.access_until ? ` until ${formatDate(sub.access_until)}` : ""
      } unless it goes through. Update your payment method to avoid losing access.`,
    };
  }
  if (sub.status === "halted") {
    return { tone: "error", text: "Payments for your plan failed several times, so paid features are paused. Pay now to restore them." };
  }
  if (sub.status === "authenticated" && !current.upcoming) {
    return { tone: "info", text: "Your payment is being confirmed. Your plan will switch over in a minute or two." };
  }
  if (sub.status === "paused") return { tone: "warn", text: "Your subscription is paused. Resume it to get paid features back." };
  if (sub.cancel_at_period_end && sub.access_until) {
    return { tone: "info", text: `Your plan is cancelled. You keep it until ${formatDate(sub.access_until)}, then move to Free.` };
  }
  if (sub.scheduled_plan) {
    return {
      tone: "info",
      text: `You'll switch to ${planLabel(sub.scheduled_plan.tier)} (${priceLabel(sub.scheduled_plan)}) on ${formatDate(
        sub.scheduled_change_at
      )}.`,
    };
  }
  return null;
}
