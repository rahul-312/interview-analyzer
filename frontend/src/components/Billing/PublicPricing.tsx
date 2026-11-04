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
import type { Interval, Price, TierWithPrices } from '@/models/Billing';
import { billingService } from '@/services/BillingService';

/** The pricing page for logged-out visitors. Paid plans sign up first, then come back here to buy. */
const PublicPricing = () => {
  const [interval, setBillingInterval] = useState<Interval>('month');
  const plans = useApi('billing-plans', () => billingService.plans());

  const actionFor = (tier: TierWithPrices, price: Price | undefined): PlanAction => {
    if (tier.code === 'free') return { label: 'Get started', href: '/register' };
    if (!plans.data?.billing_enabled) return { label: 'Payments unavailable', disabled: true };
    if (!price?.available) return { label: 'Not available yet', disabled: true };
    return { label: `Get ${tier.name}`, href: '/register?next=/pricing' };
  };

  return (
    <PublicPage>
      <div className="flex flex-col gap-8xl py-12xl">
        <PageHeader
          title="Plans"
          subtitle="Start free. Upgrade for more AI analyses and prep plans, and to keep your debriefs out of training."
          actions={<IntervalToggle value={interval} onChange={setBillingInterval} />}
        />

        {plans.loading && !plans.data && <Loading />}
        {!plans.loading && !plans.data && <ErrorMessage message={plans.error || 'Plans could not be loaded.'} />}

        {plans.data && (
          <>
            {!plans.data.billing_enabled && (
              <Notice tone="warn">Payments aren&apos;t set up on this server yet, so plans can&apos;t be bought.</Notice>
            )}

            <div className="grid grid-cols-1 gap-6xl pt-2xl lg:grid-cols-3">
              {plans.data.tiers.map((tier) => {
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

            <PlanNotes tiers={plans.data.tiers} refundDays={plans.data.refund_days} />
          </>
        )}
      </div>
    </PublicPage>
  );
};

export default PublicPricing;
