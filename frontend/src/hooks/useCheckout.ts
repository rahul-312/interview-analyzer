'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { CheckoutConfig, CheckoutResponse, CurrentSubscription, Price } from '@/models/Billing';
import { billingService } from '@/services/BillingService';
import { errorText } from '@/utils/errorText';

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let scriptLoading: Promise<void> | null = null;

/** Loads Razorpay's Checkout script once. */
export function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Checkout needs a browser.'));
  if (window.Razorpay) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return scriptLoading;
}

export type CheckoutOutcome = { kind: 'paid'; response: CheckoutResponse } | { kind: 'dismissed'; error?: string };

/**
 * Opens Razorpay Checkout for a subscription the server created. Resolves when it's paid or closed.
 * A failed attempt keeps the window open for another try, so its error is only reported if the
 * user then closes it.
 */
export async function openCheckout(config: CheckoutConfig): Promise<CheckoutOutcome> {
  await loadCheckoutScript();
  return new Promise((resolve) => {
    let lastError: string | undefined;
    const checkout = new window.Razorpay!({
      key: config.key_id,
      subscription_id: config.subscription_id,
      name: config.name,
      description: config.description,
      prefill: config.prefill,
      theme: { color: '#24412F' },
      handler: (response: CheckoutResponse) => resolve({ kind: 'paid', response }),
      modal: { ondismiss: () => resolve({ kind: 'dismissed', error: lastError }) },
    });
    checkout.on('payment.failed', (response) => {
      lastError = response.error?.description || 'The payment failed.';
    });
    checkout.open();
  });
}

export type CheckoutState =
  | { phase: 'idle' }
  | { phase: 'starting' | 'checkout' | 'verifying'; plan: string }
  /** Paid and verified, but Razorpay hasn't confirmed the subscription yet. */
  | { phase: 'pending'; plan: string }
  | { phase: 'success'; plan: string; current: CurrentSubscription }
  /** Bought to start when a subscription cancelled at period end runs out. */
  | { phase: 'scheduled'; plan: string; current: CurrentSubscription }
  | { phase: 'cancelled' }
  | { phase: 'failed'; message: string };

const BUSY = new Set(['starting', 'checkout', 'verifying']);
const POLL_MS = 3000;
const POLL_TIMES = 10;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the server shows the subscription just bought: running now, or set to start later. */
function outcomeFor(current: CurrentSubscription, price: Price): 'success' | 'scheduled' | null {
  if (current.upcoming?.plan.code === price.code) return 'scheduled';
  if (current.subscription?.plan.code === price.code && current.subscription.gives_access) return 'success';
  return null;
}

/**
 * Subscribing to a plan: create the subscription on the server, pay in Checkout, then have the
 * server verify it. The plan only counts as active once the server says so; if Razorpay hasn't
 * confirmed yet, this polls for a while and then leaves it `pending`.
 */
export function useCheckout(onChange?: (current: CurrentSubscription) => void) {
  const { refreshUser } = useAuth();
  const [state, setState] = useState<CheckoutState>({ phase: 'idle' });
  // A ref, not state: two quick clicks must not both start a checkout.
  const busy = useRef(false);

  /** `create` makes the subscription to pay for: a new one by default, or an upgrade's replacement. */
  const start = useCallback(
    async (price: Price, create: (plan: string) => Promise<CheckoutConfig> = (plan) => billingService.checkout(plan)) => {
      if (busy.current) return;
      busy.current = true;
      const plan = price.code;
      try {
        setState({ phase: 'starting', plan });
        const config = await create(plan);
        setState({ phase: 'checkout', plan });
        const outcome = await openCheckout(config);
        if (outcome.kind === 'dismissed') {
          setState(outcome.error ? { phase: 'failed', message: outcome.error } : { phase: 'cancelled' });
          return;
        }
        setState({ phase: 'verifying', plan });
        let current = await billingService.verify(outcome.response);
        // Paid and verified: from here, an error only means it isn't confirmed yet, not that it failed.
        try {
          for (let i = 0; !outcomeFor(current, price) && i < POLL_TIMES; i++) {
            setState({ phase: 'pending', plan });
            await wait(POLL_MS);
            current = await billingService.current();
          }
          onChange?.(current);
          await refreshUser();
        } catch {
          setState({ phase: 'pending', plan });
          return;
        }
        const done = outcomeFor(current, price);
        setState(done ? { phase: done, plan, current } : { phase: 'pending', plan });
      } catch (err) {
        setState({ phase: 'failed', message: errorText(err) || 'Something went wrong. Try again.' });
      } finally {
        busy.current = false;
      }
    },
    [onChange, refreshUser]
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, reset, busy: BUSY.has(state.phase) };
}
