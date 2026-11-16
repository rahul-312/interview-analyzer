import React from 'react';
import Card from '../ui/Card';
import type { Quota, Usage } from '@/models/Auth';
import { quotaText } from '@/utils/billing';
import { formatDateTime } from '@/utils/format';

function QuotaMeter({ label, quota }: { label: string; quota: Quota }) {
  const remaining = quota.remaining ?? 0;
  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap justify-between gap-x-lg text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="tabular-nums text-dark-gray">{quotaText(quota)}</span>
      </div>
      {quota.limit !== null && (
        <div
          role="meter"
          aria-label={`${label} used`}
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-valuenow={quota.used}
          className="h-sm overflow-hidden rounded-full bg-smoke-white"
        >
          <div
            className={`h-full rounded-full ${remaining ? 'bg-brand' : 'bg-amber'}`}
            style={{ width: `${quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0}%` }}
          />
        </div>
      )}
      <p className="text-xs text-medium-gray">
        {quota.used} used in the last 24 hours
        {quota.fair_use && quota.limit !== null && ` · fair-use allowance ${quota.limit}`}
        {quota.next_available_at && ` · next one frees up ${formatDateTime(quota.next_available_at)}`}
      </p>
    </div>
  );
}

/** AI analyses and prep plans used and left in the rolling 24 hours. */
const UsageCard: React.FC<{ usage: Usage }> = ({ usage }) => (
  <Card className="flex flex-col gap-6xl">
    <div>
      <h2 className="font-serif text-xl font-medium">Usage</h2>
      <p className="mt-sm text-sm text-medium-gray">
        {usage.ai_enabled
          ? `Counted over a rolling 24 hours: each run frees up 24 hours after it started. Model: ${usage.ai_model}${
              usage.priority ? ', priority queue' : ''
            }.`
          : 'AI is off for your plan on this server, so rounds and prep plans use the rule-based engine with no limits.'}
      </p>
    </div>
    {usage.ai_enabled && (
      <>
        <QuotaMeter label="AI round analyses" quota={usage.analyses} />
        <QuotaMeter label="AI prep plans" quota={usage.prep_plans} />
      </>
    )}
  </Card>
);

export default UsageCard;
