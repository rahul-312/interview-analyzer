"use client";

import { Sparkles } from "lucide-react";
import { useUsage } from "@/hooks/useUsage";
import type { Quota } from "@/models/Auth";
import { planLabel } from "@/utils/format";

/** One quota's "1 of 2 left" with a bar of what's left. */
function QuotaRow({ label, quota }: { label: string; quota: Quota }) {
  if (quota.limit === null) {
    return <p className="text-xs text-medium-gray">Unlimited {label}</p>;
  }
  const remaining = quota.remaining ?? 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-medium-gray">
        <span>{label}</span>
        <span className="tabular-nums">
          {remaining}/{quota.limit} left
        </span>
      </div>
      <div className="mt-sm h-sm overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full rounded-full ${remaining ? "bg-primary" : "bg-amber"}`}
          style={{ width: `${(remaining / quota.limit) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** The sidebar's plan card: what's left of today's AI analyses and prep plans. */
export default function PlanCard() {
  const { usage } = useUsage();
  if (!usage) return null;

  return (
    <div className="glass rounded-2xl p-4xl">
      <p className="flex items-center gap-md font-serif text-base font-medium">
        <Sparkles size={16} className="text-amber" />
        {planLabel(usage.plan)} plan
      </p>
      {usage.ai_enabled ? (
        <div className="mt-2xl flex flex-col gap-2xl">
          <QuotaRow label="Round analyses" quota={usage.analyses} />
          <QuotaRow label="Prep plans" quota={usage.prep_plans} />
          <p className="text-xxs text-light-silver">Each frees up 24 hours after it runs.</p>
        </div>
      ) : (
        <p className="mt-sm text-xs text-medium-gray">
          Rounds and prep plans use the basic rule-based engine, with no daily limits.
        </p>
      )}
    </div>
  );
}
