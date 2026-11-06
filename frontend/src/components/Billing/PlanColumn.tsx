import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import Button from '../ui/Button';
import type { Interval, Price, Tier } from '@/models/Billing';
import { allowanceText, formatPrice, intervalLabel, perMonth } from '@/utils/billing';

export interface PlanAction {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  busy?: boolean;
}

/** What a plan includes, one row per feature, in the same order for every plan so they line up. */
export function featureRows(tier: Tier): { label: string; value: string }[] {
  return [
    { label: 'AI round analyses', value: allowanceText(tier.analyses_per_24h, tier.analyses_fair_use) + (tier.analyses_fair_use ? '*' : '') },
    { label: 'AI prep plans', value: allowanceText(tier.prep_plans_per_24h) },
    { label: 'AI model', value: tier.ai_model },
    { label: 'Queue', value: tier.priority_queue ? 'Priority' : 'Normal' },
    { label: 'Debriefs used for training', value: tier.debriefs_used_for_training ? 'Yes, with notice' : 'No' },
    { label: 'Rule-based fallback', value: tier.rule_based_fallback ? 'Included' : '—' },
    { label: 'Usage tracking', value: tier.usage_tracking ? 'Included' : '—' },
    { label: 'Browser extension', value: tier.browser_extension ? 'Included' : '—' },
  ];
}

interface PlanColumnProps {
  tier: Tier;
  /** The price for the chosen period; undefined for Free, or a paid plan with no price for it. */
  price?: Price;
  interval: Interval;
  highlighted?: boolean;
  current?: boolean;
  action: PlanAction | null;
}

/** One plan on the pricing page: price, what's included and its button. */
const PlanColumn: React.FC<PlanColumnProps> = ({ tier, price, interval, highlighted, current, action }) => {
  const free = tier.code === 'free';
  return (
    <section
      aria-labelledby={`plan-${tier.code}`}
      className={`relative flex flex-col gap-6xl rounded-2xl p-8xl ${
        highlighted ? 'border-2 border-primary bg-white shadow-card' : 'glass'
      }`}
    >
      {highlighted && (
        <span className="absolute -top-2xl left-8xl inline-flex items-center gap-sm rounded-full bg-brand px-xl py-sm text-xs font-medium text-white">
          <Sparkles size={12} /> Most capable
        </span>
      )}
      <div>
        <h2 id={`plan-${tier.code}`} className="flex items-center gap-lg font-serif text-xl font-medium">
          {tier.name}
          {current && (
            <span className="rounded-full bg-primary-light px-lg py-xs text-xs font-medium text-primary-dark">Current</span>
          )}
        </h2>
        <p className="mt-2xl flex items-baseline gap-sm">
          <span className="font-serif text-stat font-medium tabular-nums">
            {free ? formatPrice(0) : price ? formatPrice(price.price_paise, price.currency) : '—'}
          </span>
          <span className="text-sm text-medium-gray">/{intervalLabel(interval)}</span>
        </p>
        <p className="mt-sm min-h-5xl text-xs text-medium-gray">
          {free
            ? interval === 'year'
              ? 'Free forever. No yearly plan needed.'
              : 'Free forever.'
            : price && interval === 'year'
              ? `Works out to ${perMonth(price)}, billed yearly.`
              : 'Billed monthly. Cancel any time.'}
        </p>
      </div>

      {action &&
        (action.href ? (
          <Button variant={highlighted ? 'primary' : 'secondary'} href={action.href}>
            {action.label}
          </Button>
        ) : (
          <Button
            variant={highlighted ? 'primary' : 'secondary'}
            onClick={action.onClick}
            disabled={action.disabled || action.busy}
            aria-busy={action.busy || undefined}
          >
            {action.busy ? 'Working…' : action.label}
          </Button>
        ))}

      <dl className="flex flex-col gap-2xl text-sm">
        {featureRows(tier).map((row) => (
          <div key={row.label} className="flex items-start gap-lg">
            <Check size={16} className="mt-xs shrink-0 text-primary" aria-hidden />
            <div className="flex flex-1 flex-wrap justify-between gap-x-lg">
              <dt className="text-medium-gray">{row.label}</dt>
              <dd className="font-medium text-ink">{row.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
};

export default PlanColumn;
