import React from 'react';
import Notice from './Notice';
import { Working } from '../ui/Feedback';
import type { CheckoutState } from '@/hooks/useCheckout';

/** What's happening with a checkout: working, done, still being confirmed, closed or failed. */
const CheckoutStatus: React.FC<{ state: CheckoutState }> = ({ state }) => {
  switch (state.phase) {
    case 'starting':
      return <Working text="Setting up your subscription…" />;
    case 'checkout':
      return <Working text="Complete the payment in the Razorpay window." />;
    case 'verifying':
      return <Working text="Confirming your payment…" />;
    case 'pending':
      return (
        <Notice tone="info">
          Payment received. Razorpay is still confirming it, and your plan will switch over as soon as it does. You
          can leave this page.
        </Notice>
      );
    case 'success':
      return <Notice tone="success">You&apos;re on {state.current.plan.name}. Thanks for subscribing!</Notice>;
    case 'cancelled':
      return <Notice tone="info">Checkout closed. You haven&apos;t been charged.</Notice>;
    case 'failed':
      return <Notice tone="error">{state.message}</Notice>;
    default:
      return null;
  }
};

export default CheckoutStatus;
