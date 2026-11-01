import React from 'react';
import Card from '../ui/Card';
import { ErrorMessage, Loading } from '../ui/Feedback';
import type { Payment } from '@/models/Billing';
import { formatPrice } from '@/utils/billing';
import { formatDate, planLabel } from '@/utils/format';

const statusClass: Record<Payment['status'], string> = {
  captured: 'bg-pale-mint text-deep-green',
  failed: 'bg-rose-pale text-rose-dark',
  refunded: 'bg-sky-light text-sky-dark',
  authorized: 'bg-amber-light text-amber-dark',
  created: 'bg-smoke-white text-dark-gray',
};

/** A refund still on its way, or one that needs support. A finished one shows as the payment's own status. */
const refundBadge: Partial<Record<Payment['refund_status'], { text: string; className: string }>> = {
  requested: { text: 'Refund on the way', className: 'bg-sky-light text-sky-dark' },
  pending: { text: 'Refund on the way', className: 'bg-sky-light text-sky-dark' },
  failed: { text: 'Refund failed, contact support', className: 'bg-rose-pale text-rose-dark' },
};

const StatusBadge = ({ payment }: { payment: Payment }) => {
  const refund = payment.status === 'refunded' ? undefined : refundBadge[payment.refund_status];
  const [text, className] = refund ? [refund.text, refund.className] : [payment.status_label, statusClass[payment.status]];
  return <span className={`rounded-full px-lg py-xs text-xs font-medium ${className}`}>{text}</span>;
};

/** "pro_plus_yearly" → "Pro Plus yearly". */
function planName(code: string | null) {
  if (!code) return 'Subscription';
  const [, tier, interval] = code.match(/^(.*)_(monthly|yearly)$/) ?? [null, code, ''];
  return `${planLabel(tier)} ${interval}`.trim();
}

interface PaymentHistoryProps {
  payments: Payment[] | null;
  loading: boolean;
  error: string | null;
}

/** Every charge, newest first. */
const PaymentHistory: React.FC<PaymentHistoryProps> = ({ payments, loading, error }) => (
  <Card className="flex flex-col gap-4xl">
    <h2 className="font-serif text-xl font-medium">Payment history</h2>
    <ErrorMessage message={error} />
    {loading && !payments ? (
      <Loading />
    ) : !payments?.length ? (
      !error && <p className="text-sm text-medium-gray">No payments yet.</p>
    ) : (
      <ul className="flex flex-col divide-y divide-light-gray text-sm">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4xl gap-y-sm py-xl">
            <div className="min-w-0">
              <p className="font-medium text-ink">{planName(p.plan)}</p>
              <p className="text-xs text-medium-gray">
                {formatDate(p.paid_at || p.created_at)}
                {p.method && ` · ${p.method_detail || p.method}`}
                {p.failure_reason && ` · ${p.failure_reason}`}
              </p>
            </div>
            <div className="flex items-center gap-xl">
              <span className="font-medium tabular-nums">{formatPrice(p.amount_paise, p.currency)}</span>
              <StatusBadge payment={p} />
            </div>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export default PaymentHistory;
