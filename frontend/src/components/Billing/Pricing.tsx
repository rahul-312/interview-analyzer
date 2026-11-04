'use client';

import React, { useCallback, useEffect, useState } from 'react';
import CheckoutStatus from './CheckoutStatus';
import IntervalToggle from './IntervalToggle';
import Notice from './Notice';
import PlanColumn, { type PlanAction } from './PlanColumn';
import PlanNotes from './PlanNotes';
import Modal from '../Modal';
import Button from '../ui/Button';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useCheckout } from '@/hooks/useCheckout';
import type { CheckoutConfig, CurrentSubscription, Interval, Price, TierWithPrices, UpgradeQuote } from '@/models/Billing';
import { billingService } from '@/services/BillingService';
import { formatPrice, priceLabel } from '@/utils/billing';
import { errorText } from '@/utils/errorText';
import { formatDate } from '@/utils/format';

const RANK = { free: 0, pro: 1, pro_plus: 2 } as const;

/** The upgrade dialog's text, from the server's quote. */
const UpgradeText = ({ price, quote }: { price: Price; quote: { data?: UpgradeQuote; error?: string } | null }) => {
  if (quote?.error) {
    // The upgrade itself doesn't need the quote: the server decides how it's made either way.
    return (
      <>
        <ErrorMessage message={`Couldn't load the upgrade details: ${quote.error}`} />
        <p>
          You can still upgrade to {priceLabel(price)} now. If the new plan has to be paid for first, Razorpay opens
          for it before anything changes.
        </p>
      </>
    );
  }
  const data = quote?.data;
  if (!data) return <p className="text-medium-gray">Working out the price…</p>;
  if (data.strategy === 'native_change') {
    return (
      <p>
        Upgrade to {priceLabel(price)} now? The new plan&apos;s features start straight away, and Razorpay bills the
        new price from now on.
      </p>
    );
  }
  if (!data.available) {
    return (
      <p>
        Your current plan was paid too long ago for its unused days to be refunded, so it can&apos;t be upgraded now.
        Cancel it at the end of the period and subscribe to {priceLabel(price)}: it starts when your current plan ends.
      </p>
    );
  }
  const credit =
    data.credit_paise > 0
      ? `About ${formatPrice(data.credit_paise, data.currency)} for the unused days of your current plan is refunded to your original payment method, usually within 5–7 working days. The exact amount is worked out when the new plan starts.`
      : data.credit_reason === 'below_minimum'
        ? 'The unused days of your current plan are worth less than ₹1, so nothing is refunded for them.'
        : '';
  return (
    <>
      <p>
        Upgrade to {priceLabel(price)} now? You&apos;ll pay {formatPrice(data.charge_paise ?? price.price_paise, data.currency)}{' '}
        in Razorpay, which sets up a new subscription for it. Your current plan ends once the payment goes through.
      </p>
      {credit && <p>{credit}</p>}
    </>
  );
};

/** The pricing page: every plan side by side, with subscribe, upgrade and switch buttons. `chosenPlan` is a price code picked before signing up. */
const Pricing: React.FC<{ chosenPlan?: string }> = ({ chosenPlan }) => {
  const { refreshUser } = useAuth();
  const [interval, setBillingInterval] = useState<Interval>('month');
  const plans = useApi('billing-plans', () => billingService.plans());
  const current = useApi('billing-current', () => billingService.current());
  const setCurrent = current.setData;

  const chosen = plans.data?.tiers.flatMap((t) => t.prices).find((p) => p.code === chosenPlan);
  const chosenInterval = chosen?.interval;
  useEffect(() => {
    if (chosenInterval) setBillingInterval(chosenInterval);
  }, [chosenInterval]);

  const onCheckoutChange = useCallback((next: CurrentSubscription) => setCurrent(next), [setCurrent]);
  const checkout = useCheckout(onCheckoutChange);

  // Plan changes go through a confirmation first. An upgrade's shows the server's quote.
  const [changeTo, setChangeTo] = useState<Price | null>(null);
  const [changing, setChanging] = useState(false);
  const [changeResult, setChangeResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [quote, setQuote] = useState<{ plan: string; data?: UpgradeQuote; error?: string } | null>(null);

  const openChange = async (price: Price, upgrade: boolean) => {
    setChangeTo(price);
    setQuote(null);
    if (!upgrade) return;
    setQuote({ plan: price.code });
    try {
      const data = await billingService.upgradeQuote(price.code);
      setQuote((q) => (q?.plan === price.code ? { plan: price.code, data } : q));
    } catch (err) {
      setQuote((q) => (q?.plan === price.code ? { plan: price.code, error: errorText(err) } : q));
    }
  };

  const closeChange = () => {
    setChangeTo(null);
    setQuote(null);
  };

  /** A replacement upgrade's subscription, created by change-plan, for Checkout to pay. */
  const upgradeCheckout = async (plan: string) => {
    const next = await billingService.changePlan(plan);
    if (!next.checkout) throw new Error('The upgrade could not be started. Try again.');
    return next.checkout;
  };

  const confirmChange = async () => {
    if (!changeTo || changing) return;
    const price = changeTo;
    if (quote?.data?.strategy === 'replacement') {
      closeChange();
      setChangeResult(null);
      await checkout.start(price, upgradeCheckout);
      return;
    }
    setChanging(true);
    // Without a quote (it failed to load), the server may still answer with an upgrade to pay for.
    let toPay: CheckoutConfig | undefined;
    try {
      const next = await billingService.changePlan(price.code);
      if (next.change === 'checkout') {
        toPay = next.checkout;
      } else {
        setCurrent(next);
        await refreshUser();
        setChangeResult({
          tone: 'success',
          text:
            next.change === 'now'
              ? `You're now on ${next.plan.name}.`
              : `You'll switch to ${priceLabel(price)} on ${formatDate(next.subscription?.scheduled_change_at)}. You keep ${next.plan.name} until then.`,
        });
      }
    } catch (err) {
      setChangeResult({ tone: 'error', text: errorText(err) });
    } finally {
      setChanging(false);
      closeChange();
    }
    if (toPay) {
      const config = toPay;
      setChangeResult(null);
      await checkout.start(price, async () => config);
    }
  };

  if ((plans.loading && !plans.data) || (current.loading && !current.data)) return <Loading />;
  if (!plans.data || !current.data) return <ErrorMessage message={plans.error || current.error || 'Plans could not be loaded.'} />;

  const { tiers, billing_enabled, refund_days } = plans.data;
  const me = current.data;
  const sub = me.subscription?.gives_access ? me.subscription : null;
  // A plan change applies to the subscription, so it's an upgrade from the subscription's tier, as the
  // server decides it, even when a higher complimentary plan is what the account is on.
  const changingFrom = sub?.plan.tier ?? me.plan.code;

  const actionFor = (tier: TierWithPrices, price: Price | undefined): PlanAction | null => {
    const sameTier = tier.code === me.plan.code;
    if ((sub && sub.plan.code === price?.code) || (sameTier && (tier.code === 'free' || me.source === 'complimentary'))) {
      return { label: 'Current plan', disabled: true };
    }
    if (tier.code === 'free') return { label: 'Move to Free', href: '/billing' };
    if (!billing_enabled) return { label: 'Payments unavailable', disabled: true };
    if (!price?.available) return { label: 'Not available yet', disabled: true };
    if (me.actions.change_plan) {
      const upgrade = RANK[tier.code] > RANK[changingFrom];
      const label = upgrade ? `Upgrade to ${tier.name}` : `Switch to ${priceLabel(price)}`;
      return {
        label,
        onClick: () => openChange(price, upgrade),
        busy: checkout.busy && 'plan' in checkout.state && checkout.state.plan === price.code,
        disabled: sub?.scheduled_plan?.code === price.code || checkout.busy,
      };
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

  const chosenTier = tiers.find((t) => t.code === chosen?.tier);
  const chosenAction = chosenTier && actionFor(chosenTier, chosen);

  return (
    <div className="flex flex-col gap-8xl">
      <PageHeader
        title="Plans"
        subtitle="Start free. Upgrade for more AI analyses and prep plans, and to keep your debriefs out of training."
        actions={<IntervalToggle value={interval} onChange={setBillingInterval} />}
      />

      <CheckoutStatus state={checkout.state} />
      {chosen && chosenAction?.onClick && checkout.state.phase === 'idle' && (
        <Notice tone="info" action={<Button variant="link" onClick={chosenAction.onClick}>{chosenAction.label}</Button>}>
          You picked {chosenTier?.name} at {priceLabel(chosen)}.
        </Notice>
      )}
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

      <PlanNotes tiers={tiers} refundDays={refund_days} />

      {changeTo && (
        <Modal title="Change plan" onClose={() => !changing && closeChange()}>
          <div className="flex flex-col gap-4xl text-sm">
            {RANK[changeTo.tier] > RANK[changingFrom] ? (
              <UpgradeText price={changeTo} quote={quote} />
            ) : (
              <p>
                {`Switch to ${priceLabel(changeTo)} at your next renewal${
                  sub?.current_end ? ` on ${formatDate(sub.current_end)}` : ''
                }? You keep your current plan until then.`}
              </p>
            )}
            <div className="flex justify-end gap-lg">
              <Button variant="secondary" onClick={closeChange} disabled={changing}>
                Not now
              </Button>
              {quote?.data?.available !== false && (
                <Button
                  variant="primary"
                  onClick={confirmChange}
                  disabled={changing || (quote !== null && !quote.data && !quote.error)}
                  aria-busy={changing || undefined}
                >
                  {changing ? 'Changing…' : quote?.data?.strategy === 'replacement' ? 'Continue to payment' : 'Confirm'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Pricing;
