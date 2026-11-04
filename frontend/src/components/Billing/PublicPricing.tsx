'use client';

import React, { useState } from 'react';
import IntervalToggle from './IntervalToggle';
import Notice from './Notice';
import PlanColumn, { type PlanAction } from './PlanColumn';
import PlanNotes from './PlanNotes';
import PublicPage from '../Home/PublicPage';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useApi } from '@/hooks/useApi';
import type { Interval, PlansResponse, Price, TierWithPrices } from '@/models/Billing';
import { billingService } from '@/services/BillingService';

/**
 * The pricing page for logged-out visitors. Paid plans sign up first, then come back here to buy.
 * `initialPlans` come from the prerender; without them, the page loads the plans itself.
 */
const PublicPricing: React.FC<{ initialPlans?: PlansResponse | null }> = ({ initialPlans }) => {
  const [interval, setBillingInterval] = useState<Interval>('month');
  const fetched = useApi(initialPlans ? null : 'billing-plans', () => billingService.publicPlans());
  const plans = initialPlans ?? fetched.data;

  const actionFor = (tier: TierWithPrices, price: Price | undefined): PlanAction => {
    if (tier.code === 'free') return { label: 'Get started', href: '/register' };
    if (!plans?.billing_enabled) return { label: 'Payments unavailable', disabled: true };
    if (!price?.available) return { label: 'Not available yet', disabled: true };
    return { label: `Get ${tier.name}`, href: `/register?next=/pricing&plan=${price.code}` };
  };

  return (
    <PublicPage returnTo="/pricing">
      <div className="flex flex-col gap-8xl py-12xl">
        <PageHeader
          title="Plans"
          subtitle="Start free. Upgrade for more AI analyses and prep plans, and to keep your debriefs out of training."
          actions={<IntervalToggle value={interval} onChange={setBillingInterval} />}
        />

        {fetched.loading && !plans && <Loading />}
        {!fetched.loading && !plans && <ErrorMessage message={fetched.error || 'Plans could not be loaded.'} />}

        {plans && (
          <>
            {!plans.billing_enabled && (
              <Notice tone="warn">Payments aren&apos;t set up on this server yet, so plans can&apos;t be bought.</Notice>
            )}

            <div className="grid grid-cols-1 gap-6xl pt-2xl lg:grid-cols-3">
              {plans.tiers.map((tier) => {
                const price = tier.prices.find((p) => p.interval === interval);
                return (
                  <PlanColumn
                    key={tier.code}
                    tier={tier}
                    price={price}
                    interval={interval}
                    highlighted={tier.code === 'pro_plus'}
                    action={actionFor(tier, price)}
                  />
                );
              })}
            </div>

            <PlanNotes tiers={plans.tiers} refundDays={plans.refund_days} />
          </>
        )}
      </div>
    </PublicPage>
  );
};

export default PublicPricing;
