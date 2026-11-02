'use client';

import React, { useState } from 'react';
import CancelDialog from './CancelDialog';
import CancelUpcomingDialog from './CancelUpcomingDialog';
import Notice from './Notice';
import PaymentHistory from './PaymentHistory';
import SubscriptionCard from './SubscriptionCard';
import UsageCard from './UsageCard';
import Button from '../ui/Button';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import type { CurrentSubscription } from '@/models/Billing';
import { billingService } from '@/services/BillingService';
import { formatPrice, subscriptionNotice } from '@/utils/billing';
import { errorText } from '@/utils/errorText';

type Message = { tone: 'success' | 'warn' | 'error'; text: string };

/** Plans & billing: the current plan, usage, payments, and changing or cancelling the subscription. */
const Billing = () => {
  const { refreshUser } = useAuth();
  const current = useApi('billing-current', () => billingService.current());
  const payments = useApi('billing-payments', () => billingService.payments());
  const [cancelOpen, setCancelOpen] = useState<'current' | 'upcoming' | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'resume' | 'pay' | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  // Runs one action at a time, then shows the server's new state everywhere.
  // `done` gives the message to show: plain text is a success.
  const run = async (kind: 'cancel' | 'resume' | 'pay', action: () => Promise<CurrentSubscription>, done: (next: CurrentSubscription) => string | Message | null) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      const next = await action();
      current.setData(next);
      payments.reload();
      await refreshUser();
      const result = done(next);
      if (result) setMessage(typeof result === 'string' ? { tone: 'success', text: result } : result);
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
      current.reload();
    } finally {
      setBusy(null);
    }
  };

  // The refund the dialog offered is sent along, so the server won't cancel without it.
  const cancel = (atPeriodEnd: boolean) =>
    run('cancel', () => billingService.cancel(atPeriodEnd, !atPeriodEnd && !!current.data?.refund), (next) => {
      setCancelOpen(null);
      if (atPeriodEnd) return "Your plan is cancelled. You'll keep it until the end of the period.";
      const ended = `Your plan has ended. You're on ${next.plan.name} now.`;
      const refunded = next.refunded;
      const refunding = refunded
        ? ` We're refunding ${formatPrice(refunded.amount_paise, refunded.currency)}; it usually arrives within 5–7 working days.`
        : '';
      if (next.refund_failed) return { tone: 'warn', text: `${ended}${refunding} We couldn't start your refund. Contact support and we'll sort it out.` };
      return `${ended}${refunding}`;
    });

  const cancelUpcoming = () =>
    run('cancel', () => billingService.cancelUpcoming(), () => {
      setCancelOpen(null);
      return "Your upcoming subscription is cancelled. You won't be charged for it.";
    });

  // A failed payment: the server gives Razorpay's link to pay again or change card. The tab is
  // opened now, during the click, so popup blockers allow it, and pointed at Razorpay once the
  // link arrives.
  const pay = async () => {
    if (busy) return;
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    let opened = false;
    await run('pay', () => billingService.resume(), (next) => {
      if (!next.payment_url) return null;
      if (!tab) {
        window.location.assign(next.payment_url); // blocked anyway: go there in this tab
        return null;
      }
      tab.location.href = next.payment_url;
      opened = true;
      return 'Razorpay opened in a new tab. Your plan comes back as soon as the payment goes through.';
    });
    if (!opened) tab?.close();
  };

  const resume = () => run('resume', () => billingService.resume(), (next) => `Welcome back to ${next.plan.name}.`);

  if (current.loading && !current.data) return <Loading />;
  if (!current.data) return <ErrorMessage message={current.error || 'Your plan could not be loaded.'} />;

  const me = current.data;
  const sub = me.subscription;
  const notice = subscriptionNotice(me);
  const isPaid = me.plan.code !== 'free';

  return (
    <div className="flex flex-col gap-8xl">
      <PageHeader
        title="Plans & billing"
        subtitle="Your plan, what you've used today, and your payments."
        actions={
          <Button variant="primary" href="/pricing">
            {isPaid ? 'Compare plans' : 'Upgrade'}
          </Button>
        }
      />

      {notice && (
        <Notice
          tone={notice.tone}
          action={
            me.actions.pay ? (
              <Button variant="primary" onClick={pay} disabled={!!busy} aria-busy={busy === 'pay' || undefined}>
                {busy === 'pay' ? 'Opening…' : 'Update payment'}
              </Button>
            ) : me.actions.resume ? (
              <Button variant="primary" onClick={resume} disabled={!!busy} aria-busy={busy === 'resume' || undefined}>
                {busy === 'resume' ? 'Resuming…' : 'Resume'}
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {current.error && <ErrorMessage message={`Couldn't refresh: ${current.error}`} />}

      <div className="grid grid-cols-1 gap-6xl lg:grid-cols-2">
        <SubscriptionCard current={me}>
          <div className="flex flex-wrap gap-lg">
            {me.actions.change_plan && (
              <Button variant="secondary" href="/pricing">
                Change plan
              </Button>
            )}
            {me.actions.subscribe && !isPaid && (
              <Button variant="secondary" href="/pricing">
                See plans
              </Button>
            )}
            {sub && me.actions.cancel && (
              <Button variant="danger" onClick={() => setCancelOpen('current')} disabled={!!busy}>
                Cancel subscription
              </Button>
            )}
            {me.upcoming && me.actions.cancel_upcoming && (
              <Button variant="secondary" onClick={() => setCancelOpen('upcoming')} disabled={!!busy}>
                Cancel upcoming subscription
              </Button>
            )}
          </div>
        </SubscriptionCard>
        <UsageCard usage={me.usage} />
      </div>

      <PaymentHistory payments={payments.data} loading={payments.loading} error={payments.error} />

      {cancelOpen === 'current' && sub && (
        <CancelDialog
          subscription={sub}
          canWaitForPeriodEnd={me.actions.cancel_at_period_end}
          refund={me.refund}
          busy={busy === 'cancel'}
          onConfirm={cancel}
          onClose={() => setCancelOpen(null)}
        />
      )}
      {cancelOpen === 'upcoming' && me.upcoming && (
        <CancelUpcomingDialog
          subscription={me.upcoming}
          busy={busy === 'cancel'}
          onConfirm={cancelUpcoming}
          onClose={() => setCancelOpen(null)}
        />
      )}
    </div>
  );
};

export default Billing;
