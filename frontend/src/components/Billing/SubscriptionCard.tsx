import React from 'react';
import Card from '../ui/Card';
import type { CurrentSubscription } from '@/models/Billing';
import { priceLabel } from '@/utils/billing';
import { formatDate } from '@/utils/format';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-2xl gap-y-xs border-b border-light-gray py-lg last:border-0">
      <dt className="text-medium-gray">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

/** The current plan and the subscription behind it. `children` holds the actions. */
const SubscriptionCard: React.FC<{ current: CurrentSubscription; children?: React.ReactNode }> = ({ current, children }) => {
  const sub = current.subscription;
  const ended = sub && ['cancelled', 'completed', 'expired'].includes(sub.status);
  return (
    <Card className="flex flex-col gap-4xl">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-medium-gray">Current plan</p>
        <h2 className="mt-sm font-serif text-heading font-medium">{current.plan.name}</h2>
        {current.source === 'complimentary' && (
          <p className="mt-sm text-sm text-medium-gray">Added to your account by the team, at no charge.</p>
        )}
        {current.source === 'free' && !sub?.gives_access && (
          <p className="mt-sm text-sm text-medium-gray">You&apos;re on the free plan. Upgrade any time.</p>
        )}
      </div>

      {sub && (
        <dl className="text-sm">
          <Row label="Subscription" value={priceLabel(sub.plan)} />
          <Row
            label="Status"
            value={sub.cancel_at_period_end && sub.status === 'active' ? 'Cancelled at period end' : sub.status_label}
          />
          <Row label="Billing cycle" value={sub.interval === 'year' ? 'Yearly' : 'Monthly'} />
          {sub.current_end && !ended && <Row label="Current period ends" value={formatDate(sub.current_end)} />}
          {sub.next_charge_at && !sub.cancel_at_period_end && sub.status === 'active' && (
            <Row label="Next billing date" value={formatDate(sub.next_charge_at)} />
          )}
          {sub.access_until && <Row label="Access until" value={formatDate(sub.access_until)} />}
          {sub.ended_at && <Row label="Ended" value={formatDate(sub.ended_at)} />}
          {sub.scheduled_plan && (
            <Row label="Scheduled change" value={`${priceLabel(sub.scheduled_plan)} from ${formatDate(sub.scheduled_change_at)}`} />
          )}
        </dl>
      )}

      {current.upcoming && (
        <p className="text-sm text-medium-gray">
          Your new {priceLabel(current.upcoming.plan)} subscription starts on {formatDate(current.upcoming.start_at)}.
        </p>
      )}
      {children}
    </Card>
  );
};

export default SubscriptionCard;
