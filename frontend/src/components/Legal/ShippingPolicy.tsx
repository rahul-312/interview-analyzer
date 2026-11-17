import React from 'react';
import LegalPage, { Email, Section } from './LegalPage';
import { legal } from '@/config/legal';

const ShippingPolicy: React.FC = () => (
  <LegalPage title="Shipping & Delivery Policy" intro={`${legal.service} is an online service. Nothing is shipped.`}>
    <Section title="1. Digital delivery">
      <p>
        Pro and Pro Plus are subscriptions to an online software service. There are no physical goods, so there’s no
        shipping and no shipping charge.
      </p>
    </Section>

    <Section title="2. When you get access">
      <p>
        Your plan is activated on your account as soon as Razorpay confirms your payment, usually within a few minutes.
        You can see your plan, usage and payment history in Plans &amp; billing, and Razorpay emails you a receipt.
      </p>
    </Section>

    <Section title="3. Not activated?">
      <p>
        If your plan isn’t active within 24 hours of a successful payment, email <Email /> with your account email and
        the Razorpay payment ID. We’ll activate it or refund the payment.
      </p>
    </Section>

    <Section title="4. Where it’s available">
      <p>
        The service is used online, through the website and the browser extension. It’s run from {legal.address}.
      </p>
    </Section>
  </LegalPage>
);

export default ShippingPolicy;
