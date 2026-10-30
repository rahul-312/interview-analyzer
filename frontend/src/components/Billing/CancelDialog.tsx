import React, { useState } from 'react';
import Modal from '../Modal';
import Button from '../ui/Button';
import type { Subscription } from '@/models/Billing';
import { formatDate } from '@/utils/format';

interface CancelDialogProps {
  subscription: Subscription;
  /** Cancelling at period end is only possible while a paid period is running. */
  canWaitForPeriodEnd: boolean;
  busy: boolean;
  onConfirm: (atPeriodEnd: boolean) => void;
  onClose: () => void;
}

/** Asks when to cancel: at the end of the paid period (the default) or now. */
const CancelDialog: React.FC<CancelDialogProps> = ({ subscription, canWaitForPeriodEnd, busy, onConfirm, onClose }) => {
  const [atPeriodEnd, setAtPeriodEnd] = useState(canWaitForPeriodEnd);
  const end = subscription.current_end ? formatDate(subscription.current_end) : 'the end of the period';

  return (
    <Modal title="Cancel subscription" onClose={() => !busy && onClose()}>
      <form
        className="flex flex-col gap-4xl text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(atPeriodEnd);
        }}
      >
        <fieldset className="flex flex-col gap-2xl">
          <legend className="mb-lg text-medium-gray">When should it end?</legend>
          {canWaitForPeriodEnd && (
            <label className="flex cursor-pointer items-start gap-lg rounded-xl border border-input-border p-2xl has-checked:border-primary has-checked:bg-primary-light">
              <input type="radio" name="when" checked={atPeriodEnd} onChange={() => setAtPeriodEnd(true)} className="mt-xs" />
              <span>
                <span className="font-medium text-ink">At the end of the period ({end})</span>
                <span className="block text-medium-gray">You keep paid features until then and won&apos;t be charged again.</span>
              </span>
            </label>
          )}
          <label className="flex cursor-pointer items-start gap-lg rounded-xl border border-input-border p-2xl has-checked:border-crimson-red has-checked:bg-rose-pale">
            <input type="radio" name="when" checked={!atPeriodEnd} onChange={() => setAtPeriodEnd(false)} className="mt-xs" />
            <span>
              <span className="font-medium text-ink">Now</span>
              <span className="block text-medium-gray">Paid features stop straight away. The current period isn&apos;t refunded.</span>
            </span>
          </label>
        </fieldset>
        <p className="text-xs text-medium-gray">A cancellation can&apos;t be undone, but you can subscribe again at any time.</p>
        <div className="flex justify-end gap-lg">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep my plan
          </Button>
          <Button type="submit" variant="danger" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Cancelling…' : 'Cancel subscription'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CancelDialog;
