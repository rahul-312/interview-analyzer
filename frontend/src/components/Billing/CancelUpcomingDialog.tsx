import React from 'react';
import Modal from '../Modal';
import Button from '../ui/Button';
import type { Subscription } from '@/models/Billing';
import { priceLabel } from '@/utils/billing';
import { formatDate } from '@/utils/format';

interface CancelUpcomingDialogProps {
  /** The subscription bought to start when the current one ends. */
  subscription: Subscription;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirms cancelling a subscription that hasn't started yet. Nothing has been charged for it. */
const CancelUpcomingDialog: React.FC<CancelUpcomingDialogProps> = ({ subscription, busy, onConfirm, onClose }) => (
  <Modal title="Cancel upcoming subscription" onClose={() => !busy && onClose()}>
    <div className="flex flex-col gap-4xl text-sm">
      <p className="text-medium-gray">
        Your {priceLabel(subscription.plan)} subscription won&apos;t start on {formatDate(subscription.start_at)}, and
        you won&apos;t be charged for it. Your current plan still runs to the end of its period.
      </p>
      <div className="flex justify-end gap-lg">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Cancelling…' : 'Cancel upcoming subscription'}
        </Button>
      </div>
    </div>
  </Modal>
);

export default CancelUpcomingDialog;
