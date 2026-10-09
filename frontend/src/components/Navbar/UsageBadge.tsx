"use client";

import { Sparkles } from "lucide-react";
import { useUsage } from "@/hooks/useUsage";

/** "Free · 1/2 analyses · 2/2 plans left", or "Pro · Unlimited". */
export default function UsageBadge() {
  const { usage } = useUsage();
  if (!usage) return null;

  const { analyses, prep_plans: plans } = usage;
  const unlimited = analyses.limit === null && plans.limit === null;
  const empty = analyses.remaining === 0 || plans.remaining === 0;

  return (
    <span
      title={
        unlimited
          ? undefined
          : `Per 24 hours: ${analyses.limit} round analyses and ${plans.limit} prep plans. Each frees up 24 hours after it runs.`
      }
      className={`inline-flex items-center gap-sm whitespace-nowrap rounded-full px-xl py-sm text-xs font-medium ${
        empty ? "bg-amber-light text-amber-dark" : "bg-primary-light text-primary-dark"
      }`}
    >
      <Sparkles size={14} />
      {unlimited
        ? "Pro · Unlimited"
        : `Free · ${analyses.remaining}/${analyses.limit} analyses · ${plans.remaining}/${plans.limit} plans left`}
    </span>
  );
}
