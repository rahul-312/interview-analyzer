'use client';

import React, { useCallback, useState } from 'react';
import CheckoutStatus from './CheckoutStatus';
import IntervalToggle from './IntervalToggle';
import Notice from './Notice';
import PlanColumn, { type PlanAction } from './PlanColumn';
import Modal from '../Modal';
import Button from '../ui/Button';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useCheckout } from '@/hooks/useCheckout';
import type { CurrentSubscription, Interval, Price, TierWithPrices } from '@/models/Billing';
import { billingService } from '@/services/BillingService';
import { fairUseNote, priceLabel } from '@/utils/billing';
import { errorText } from '@/utils/errorText';
import { formatDate } from '@/utils/format';

const RANK = { free: 0, pro: 1, pro_plus: 2 } as const;

/** The pricing page: every plan side by side, with subscribe, upgrade and switch buttons. */
const Pricing = () => {
  const { refreshUser } = useAuth();
  const [interval, setBillingInterval] = useState<Interval>('month');
  const plans = useApi('billing-plans', () => billingService.plans());
  const current = useApi('billing-current', () => billingService.current());
  const setCurrent = current.setData;

  const onCheckoutChange = useCallback((next: CurrentSubscription) => setCurrent(next), [setCurrent]);
  const checkout = useCheckout(onCheckoutChange);

  // Plan changes go through a confirmation first.
  const [changeTo, setChangeTo] = useState<Price | null>(null);
  const [changing, setChanging] = useState(false);
  const [changeResult, setChangeResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const confirmChange = async () => {
    if (!changeTo || changing) return;
    setChanging(true);
    try {
      const next = await billingService.changePlan(changeTo.code);
      setCurrent(next);
      await refreshUser();
      setChangeResult({
        tone: 'success',
        text:
          next.change === 'now'
            ? `You're now on ${next.plan.name}.`
            : `You'll switch to ${priceLabel(changeTo)} on ${formatDate(next.subscription?.scheduled_change_at)}. You keep ${next.plan.name} until then.`,
      });
    } catch (err) {
      setChangeResult({ tone: 'error', text: errorText(err) });
    } finally {
      setChanging(false);
      setChangeTo(null);
    }
  };

  if ((plans.loading && !plans.data) || (current.loading && !current.data)) return <Loading />;
  if (!plans.data || !current.data) return <ErrorMessage message={plans.error || current.error || 'Plans could not be loaded.'} />;

  const { tiers, billing_enabled, refund_days } = plans.data;
  const me = current.data;
  const sub = me.subscription?.gives_access ? me.subscription : null;

  const actionFor = (tier: TierWithPrices, price: Price | undefined): PlanAction | null => {
    const sameTier = tier.code === me.plan.code;
    if (sameTier && (tier.code === 'free' || me.source === 'complimentary' || sub?.plan.code === price?.code)) {
      return { label: 'Current plan', disabled: true };
    }
    if (tier.code === 'free') return { label: 'Move to Free', href: '/billing' };
    if (!billing_enabled) return { label: 'Payments unavailable', disabled: true };
    if (!price?.available) return { label: 'Not available yet', disabled: true };
    if (me.actions.change_plan) {
      const label = RANK[tier.code] > RANK[me.plan.code] ? `Upgrade to ${tier.name}` : `Switch to ${priceLabel(price)}`;
      return { label, onClick: () => setChangeTo(price), disabled: sub?.scheduled_plan?.code === price.code };
    }
    if (me.actions.subscribe) {
      return {
        label: `Get ${tier.name}`,
        onClick: () => checkout.start(price),
        busy: checkout.busy && 'plan' in checkout.state && checkout.state.plan === price.code,
        disabled: checkout.busy,
      };
    }
    return { label: 'Manage plan', href: '/billing' };
  };

  const proPlus = tiers.find((t) => t.code === 'pro_plus');

  return (
    <div className="flex flex-col gap-8xl">
      <PageHeader
        title="Plans"
        subtitle="Start free. Upgrade for more AI analyses and prep plans, and to keep your debriefs out of training."
        actions={<IntervalToggle value={interval} onChange={setBillingInterval} />}
      />

      <CheckoutStatus state={checkout.state} />
      {changeResult && <Notice tone={changeResult.tone}>{changeResult.text}</Notice>}
      {!billing_enabled && <Notice tone="warn">Payments aren&apos;t set up on this server yet, so plans can&apos;t be bought.</Notice>}
      {me.subscription && !me.subscription.gives_access && me.actions.pay && (
        <Notice tone="error" action={<Button variant="link" href="/billing">Fix payment</Button>}>
          Your last payment failed, so paid features are paused.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-6xl pt-2xl lg:grid-cols-3">
        {tiers.map((tier) => {
          const price = tier.prices.find((p) => p.interval === interval);
          return (
            <PlanColumn
              key={tier.code}
              tier={tier}
              price={price}
              interval={interval}
              highlighted={tier.code === 'pro_plus'}
              current={tier.code === me.plan.code}
              action={actionFor(tier, price)}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-md text-xs text-medium-gray">
        {proPlus && <p>* {fairUseNote(proPlus)}</p>}
        <p>
          Limits count over a rolling 24 hours: each run frees up 24 hours after it started. Runs that fail for reasons
          that aren&apos;t yours are given back. On Free, your debriefs may be used to improve the AI; on Pro and Pro
          Plus they never are.
        </p>
        <p>
          Upgrades apply straight away. Downgrades and monthly/yearly switches apply at your next renewal. Prices are in
          INR and billed by Razorpay.
        </p>
        <p>
          {refund_days > 0 &&
            `${refund_days}-day money-back guarantee: cancel within ${refund_days} days of a new subscription's first payment for a full refund, once per account. `}
          After that, cancelling stops renewals and you keep your plan until the end of the period you paid for; that
          period isn&apos;t refunded.
        </p>
      </div>

      {changeTo && (
        <Modal title="Change plan" onClose={() => !changing && setChangeTo(null)}>
          <div className="flex flex-col gap-4xl text-sm">
            <p>
              {RANK[changeTo.tier] > RANK[me.plan.code]
                ? `Upgrade to ${priceLabel(changeTo)} now? The new plan's features start straight away, and Razorpay bills the new price from now on.`
                : `Switch to ${priceLabel(changeTo)} at your next renewal${
                    sub?.current_end ? ` on ${formatDate(sub.current_end)}` : ''
                  }? You keep your current plan until then.`}
            </p>
            <div className="flex justify-end gap-lg">
              <Button variant="secondary" onClick={() => setChangeTo(null)} disabled={changing}>
                Not now
              </Button>
              <Button variant="primary" onClick={confirmChange} disabled={changing} aria-busy={changing || undefined}>
                {changing ? 'Changing…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Pricing;
