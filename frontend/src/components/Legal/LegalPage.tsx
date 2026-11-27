'use client';

import React from 'react';
import Head from 'next/head';
import PublicPage from '../Home/PublicPage';
import { legal } from '@/config/legal';
import { useAuth } from '@/context/AuthContext';

interface LegalPageProps {
  title: string;
  /** One line under the title. */
  intro?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A policy or contact page. Logged-out visitors (and Razorpay's reviewers) see it with the public top bar and
 * footer; logged-in users see it inside the app.
 */
const LegalPage: React.FC<LegalPageProps> = ({ title, intro, children }) => {
  const { user } = useAuth();

  const body = (
    <article className="mx-auto flex max-w-modal-wide flex-col gap-8xl py-12xl text-charcoal-gray">
      <Head>
        <title>{`${title} · ${legal.service}`}</title>
      </Head>
      <header className="flex flex-col gap-lg">
        <h1 className="font-serif text-heading font-medium tracking-tight text-ink md:text-title">{title}</h1>
        {intro && <p className="text-medium-gray">{intro}</p>}
        <p className="text-xs text-medium-gray">Last updated: {legal.lastUpdated}</p>
      </header>
      {children}
    </article>
  );

  return user ? body : <PublicPage>{body}</PublicPage>;
};

/** A numbered or titled part of a policy. */
export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-2xl leading-relaxed">
    <h2 className="font-serif text-xl font-medium text-ink">{title}</h2>
    {children}
  </section>
);

/** A bulleted list inside a section. */
export const List: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="flex list-disc flex-col gap-md pl-8xl">{children}</ul>
);

/** The support email as a link. */
export const Email: React.FC = () => (
  <a href={`mailto:${legal.email}`} className="font-medium text-primary hover:underline">
    {legal.email}
  </a>
);

export default LegalPage;
