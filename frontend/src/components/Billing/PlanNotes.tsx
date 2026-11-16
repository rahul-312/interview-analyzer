import React from 'react';
import type { TierWithPrices } from '@/models/Billing';
import { fairUseNote } from '@/utils/billing';

/** The small print under the plans: limits, training, plan changes and refunds. */
const PlanNotes: React.FC<{ tiers: TierWithPrices[]; refundDays: number }> = ({ tiers, refundDays }) => {
  const proPlus = tiers.find((t) => t.code === 'pro_plus');

  return (
    <div className="flex flex-col gap-md text-xs text-medium-gray">
      {proPlus && <p>* {fairUseNote(proPlus)}</p>}
      <p>
        Limits count over a rolling 24 hours: each run frees up 24 hours after it started. Runs that fail for reasons
        that aren&apos;t yours are given back. On Free, your debriefs may be used to improve the AI; on Pro and Pro
        Plus they never are.
      </p>
      <p>
        Upgrades apply straight away. Paying by UPI Autopay or eMandate, an upgrade starts a new subscription and
        refunds the unused days of your current one. Downgrades and monthly/yearly switches apply at your next
        renewal. Prices are in INR and billed by Razorpay.
      </p>
      <p>
        {refundDays > 0 &&
          `${refundDays}-day money-back guarantee: cancel within ${refundDays} days of a new subscription's first payment for a full refund, once per account. `}
        After that, cancelling stops renewals and you keep your plan until the end of the period you paid for; that
        period isn&apos;t refunded.
      </p>
    </div>
  );
};

export default PlanNotes;
