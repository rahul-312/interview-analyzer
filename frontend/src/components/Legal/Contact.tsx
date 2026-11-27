import React from 'react';
import Link from 'next/link';
import LegalPage, { Email, Section } from './LegalPage';
import { legal, legalLinks } from '@/config/legal';

const Contact: React.FC = () => (
  <LegalPage title="Contact us" intro="Questions about your account, a payment or a refund? Get in touch.">
    <dl className="grid grid-cols-1 gap-6xl rounded-2xl border border-light-gray bg-white p-8xl sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-medium-gray">Business</dt>
        <dd className="mt-sm text-ink">{legal.operator}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-medium-gray">Email</dt>
        <dd className="mt-sm">
          <Email />
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-medium-gray">Phone</dt>
        <dd className="mt-sm">
          <a href={legal.phoneHref} className="font-medium text-primary hover:underline">
            {legal.phone}
          </a>
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-medium-gray">Address</dt>
        <dd className="mt-sm text-ink">{legal.address}</dd>
      </div>
    </dl>

    <Section title="Support">
      <p>
        Email is the quickest way to reach us. We reply within 2 working days. For a payment or refund, include the
        email address of your account and the Razorpay payment or subscription ID from your receipt, so we can find
        it straight away.
      </p>
    </Section>

    <Section title="Policies">
      <ul className="flex flex-col gap-md">
        {legalLinks
          .filter((l) => l.href !== '/contact')
          .map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="font-medium text-primary hover:underline">
                {l.label}
              </Link>
            </li>
          ))}
      </ul>
    </Section>
  </LegalPage>
);

export default Contact;
