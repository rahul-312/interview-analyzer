"use client";

import { Sparkles } from "lucide-react";
import { useUsage } from "@/hooks/useUsage";
import type { Quota } from "@/models/Auth";
import { planLabel } from "@/utils/format";

const left = (q: Quota, noun: string) =>
  q.fair_use ? `unlimited ${noun} (fair use)` : q.limit === null ? `unlimited ${noun}` : `${q.remaining}/${q.limit} ${noun}`;

/**
 * "Free · 1/2 analyses · 2/2 plans left", or "Pro · Unlimited". Each quota can be unlimited on its own.
 * With AI off on the server, "Free · Basic analysis": nothing is limited, but that isn't a perk of the plan.
 */
export default function UsageBadge() {
  const { usage } = useUsage();
  if (!usage) return null;

  if (!usage.ai_enabled) {
    return (
      <span
        title="AI analysis is off, so rounds and prep plans use the basic rule-based engine, with no limits."
        className="inline-flex items-center gap-sm whitespace-nowrap glass rounded-full px-2xl py-md text-xs font-medium text-dark-gray"
      >
        <Sparkles size={14} />
        {planLabel(usage.plan)} · Basic analysis
      </span>
    );
  }

  const { analyses, prep_plans: plans } = usage;
  const unlimited = analyses.limit === null && plans.limit === null;
  const empty = analyses.remaining === 0 || plans.remaining === 0;

  return (
    <span
      title={
        unlimited
          ? undefined
          : `Per 24 hours: ${left(analyses, "round analyses")} and ${left(plans, "prep plans")} left. Each frees up 24 hours after it runs.`
      }
      className={`inline-flex items-center gap-sm whitespace-nowrap rounded-full px-xl py-sm text-xs font-medium ${
        empty ? "bg-amber-light text-amber-dark" : "bg-primary-light text-primary-dark"
      }`}
    >
      <Sparkles size={14} />
      {planLabel(usage.plan)} · {unlimited ? "Unlimited" : `${left(analyses, "analyses")} · ${left(plans, "plans")} left`}
    </span>
  );
}
