/**
 * Business details shown on the legal pages (Contact, Terms, Privacy, Refunds, Shipping). Razorpay checks
 * these against the account before turning on live payments, so keep them identical to it.
 *
 * The contact details come from NEXT_PUBLIC_LEGAL_* (frontend/.env.local, or the project's environment
 * variables on Vercel), so they aren't in the repo. They're built into the pages, so they're still public.
 * A production build on Vercel fails if any is missing (next.config.ts).
 */
const phone = process.env.NEXT_PUBLIC_LEGAL_PHONE?.trim() ?? '';

export const legal = {
  service: 'Interview Analyzer',
  /** The name the Razorpay account is registered under (the person or business that runs the service). */
  operator: process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() ?? '',
  email: process.env.NEXT_PUBLIC_LEGAL_EMAIL?.trim() ?? '',
  phone,
  phoneHref: `tel:${phone.replace(/[^\d+]/g, '')}`,
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim() ?? '',
  /** Courts named in the Terms. */
  jurisdiction: 'Hyderabad, Telangana, India',
  minimumAge: 18,
  lastUpdated: '17 November 2026',
  /**
   * The server's defaults (BILLING_REFUND_DAYS, BILLING_GRACE_DAYS). The refund policy and terms read the real
   * values from the plans API when they're built; these are only used if it can't be reached then.
   */
  refundDays: 7,
  graceDays: 3,
};

/** The legal pages, in the order the footer lists them. */
export const legalLinks = [
  { href: '/contact', label: 'Contact us' },
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Cancellation & Refunds' },
  { href: '/shipping-policy', label: 'Shipping & Delivery' },
];
