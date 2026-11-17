import React from 'react';
import LegalPage, { Email, List, Section } from './LegalPage';
import { legal } from '@/config/legal';

export interface BillingDays {
  /** The money-back window (BILLING_REFUND_DAYS); 0 means there isn't one. */
  refundDays?: number;
  /** Paid access kept after a failed renewal (BILLING_GRACE_DAYS). */
  graceDays?: number;
}

const RefundPolicy: React.FC<BillingDays> = ({ refundDays = legal.refundDays, graceDays = legal.graceDays }) => (
  <LegalPage
    title="Cancellation & Refund Policy"
    intro="How cancelling, refunds, upgrades and failed payments work for Pro and Pro Plus."
  >
    <Section title="1. Free plan">
      <p>The Free plan is free, so there’s nothing to cancel or refund.</p>
    </Section>

    <Section title="2. Subscriptions renew until you cancel">
      <p>
        Pro and Pro Plus are monthly or yearly subscriptions that renew automatically through Razorpay. You can cancel
        at any time from <strong className="font-medium text-ink">Plans &amp; billing</strong> in the app.
      </p>
    </Section>

    {refundDays > 0 ? (
      <Section title={`3. ${refundDays}-day money-back guarantee`}>
        <List>
          <li>
            If you cancel within {refundDays} days of a new subscription’s first payment, choosing{' '}
            <strong className="font-medium text-ink">Cancel now</strong>, we refund everything you paid for that
            subscription in full, and your paid access ends straight away.
          </li>
          <li>
            It applies once per account. Any earlier refund on your account uses it up, except a refund of unused days
            after an upgrade.
          </li>
          <li>It counts from the first payment, so renewals don’t qualify.</li>
          <li>
            Choosing to cancel at the end of the period instead means you keep your plan until then, and the money-back
            refund no longer applies.
          </li>
        </List>
      </Section>
    ) : (
      <Section title="3. No money-back period">
        <p>Payments aren’t refunded when you cancel, except as described below.</p>
      </Section>
    )}

    <Section title={refundDays > 0 ? `4. Cancelling after ${refundDays} days` : '4. Cancelling'}>
      <List>
        <li>
          <strong className="font-medium text-ink">Cancel at period end</strong> (the default): no further payments are
          taken, and you keep your plan until the end of the period you’ve paid for.
        </li>
        <li>
          <strong className="font-medium text-ink">Cancel now</strong>: your paid access ends straight away.
        </li>
        <li>In both cases the current period isn’t refunded, in full or in part.</li>
      </List>
    </Section>

    <Section title="5. Upgrades, downgrades and switching">
      <List>
        <li>
          If you pay by card, upgrading from Pro to Pro Plus moves your subscription to the new plan straight away, and
          Razorpay charges for it under its rules for plan changes. We don’t refund the unused days of the old plan.
        </li>
        <li>
          If you pay by UPI Autopay or eMandate, Razorpay can’t change the plan, so an upgrade starts a new
          subscription. It takes effect once you’ve paid for it; we then cancel your current one and refund its unused
          days to its original payment method. Amounts under ₹1 aren’t refunded. If your current plan was paid for
          more than about 6 months ago, its unused days can’t be refunded, so this upgrade isn’t offered.
        </li>
        <li>Downgrades and switches between monthly and yearly take effect at your next renewal, with no refund.</li>
      </List>
    </Section>

    <Section title="6. Failed renewals">
      <p>
        If a renewal payment fails, Razorpay retries it, and you keep your plan for {graceDays} days after the
        period ends. You can update your payment method from Plans &amp; billing. If payment still doesn’t go through,
        your account moves to the Free plan; your data is kept.
      </p>
    </Section>

    <Section title="7. How refunds are paid">
      <p>
        Refunds go back to the original payment method through Razorpay. Once we start a refund it usually reaches you
        within 5–7 working days, though some banks take longer. You’ll see its status in Plans &amp; billing.
      </p>
    </Section>

    <Section title="8. Charged by mistake?">
      <p>
        If you were charged twice or incorrectly, email <Email /> within 30 days with your account email and the
        Razorpay payment ID, and we’ll refund any charge made in error.
      </p>
    </Section>
  </LegalPage>
);

export default RefundPolicy;
