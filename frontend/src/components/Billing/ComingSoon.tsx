import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import Button from '../ui/Button';
import { featureRows, type FeatureKey } from './PlanColumn';
import type { Tier } from '@/models/Billing';

const PREVIEW_ROWS: FeatureKey[] = ['analyses', 'prep_plans', 'ai_model', 'training'];

/** What a tier's preview card lists. The model row is left out when the server has no key for it, rather than naming the rule-based engine. */
const previewRows = (tier: Tier) =>
  featureRows(tier).filter((row) => PREVIEW_ROWS.includes(row.key) && (row.key !== 'ai_model' || tier.ai_available));

const allows = (limit: number | null) => limit === null || limit > 0;

/** What Free gives today, from the server's own Free tier, so it never promises AI the server can't run. */
function freeText(free: Tier | undefined): string {
  const ai = free?.ai_available
    ? [allows(free.analyses_per_24h) && 'AI round analyses', allows(free.prep_plans_per_24h) && 'prep plans'].filter(Boolean)
    : [];
  const base = 'Until then, Free lets you track applications and debrief your rounds';
  return ai.length ? `${base}, with ${ai.join(' and ')} included.` : `${base}.`;
}

interface ComingSoonProps {
  tiers: Tier[];
  action: { label: string; href: string };
}

/** Shown in place of the plans while payments aren't set up: what the paid plans will add, with no prices or buy buttons. */
const ComingSoon: React.FC<ComingSoonProps> = ({ tiers, action }) => {
  const paid = tiers.filter((t) => t.code !== 'free');
  return (
    <section aria-labelledby="coming-soon" className="flex flex-col items-center gap-8xl py-8xl text-center">
      <span className="inline-flex items-center gap-sm rounded-full bg-primary-light px-xl py-sm text-xs font-medium text-primary-dark">
        <Sparkles size={12} aria-hidden /> Coming soon
      </span>
      <div className="flex max-w-[40rem] flex-col gap-2xl">
        <h1 id="coming-soon" className="font-serif text-heading font-medium tracking-tight text-ink md:text-title">
          Paid plans are on the way
        </h1>
        <p className="text-medium-gray">
          We&apos;re finishing payments. {freeText(tiers.find((t) => t.code === 'free'))}
        </p>
      </div>

      <Button variant="primary" href={action.href}>
        {action.label}
      </Button>

      {paid.length > 0 && (
        <div className="grid w-full max-w-[56rem] grid-cols-1 gap-6xl pt-2xl text-left md:grid-cols-2">
          {paid.map((tier) => (
            <div key={tier.code} className="glass flex flex-col gap-4xl rounded-2xl p-8xl">
              <h2 className="flex items-center justify-between font-serif text-xl font-medium">
                {tier.name}
                <span className="rounded-full bg-page-bg px-lg py-xs font-sans text-xs font-medium text-medium-gray">
                  Coming soon
                </span>
              </h2>
              <dl className="flex flex-col gap-2xl text-sm">
                {previewRows(tier).map((row) => (
                  <div key={row.key} className="flex items-start gap-lg">
                    <Check size={16} className="mt-xs shrink-0 text-primary" aria-hidden />
                    <div className="flex flex-1 flex-wrap justify-between gap-x-lg">
                      <dt className="text-medium-gray">{row.label}</dt>
                      <dd className="font-medium text-ink">{row.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ComingSoon;
