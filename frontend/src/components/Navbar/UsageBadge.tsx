"use client";

import { Sparkles } from "lucide-react";
import { useUsage } from "@/hooks/useUsage";

/** "Free · 1 of 2 analyses left today", or "Pro · Unlimited analyses". */
export default function UsageBadge() {
  const { usage } = useUsage();
  if (!usage) return null;

  const unlimited = usage.limit === null;
  const empty = usage.remaining === 0;

  return (
    <span
      title={unlimited ? undefined : "Analyses free up 24 hours after each one runs"}
      className={`inline-flex items-center gap-sm whitespace-nowrap rounded-full px-xl py-sm text-xs font-medium ${
        empty ? "bg-amber-light text-amber-dark" : "bg-primary-light text-primary-dark"
      }`}
    >
      <Sparkles size={14} />
      {unlimited
        ? "Pro · Unlimited analyses"
        : `Free · ${usage.remaining} of ${usage.limit} analyses left today`}
    </span>
  );
}
