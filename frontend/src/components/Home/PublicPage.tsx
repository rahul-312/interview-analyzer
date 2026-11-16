'use client';

import React, { useEffect } from 'react';
import Logo from '../Logo';
import Button from '../ui/Button';
import { useAuth } from '@/context/AuthContext';

interface PublicPageProps {
  children: React.ReactNode;
  /** Where logging in or signing up from this page comes back to. */
  returnTo?: string;
}

/** The top bar and footer around pages for logged-out visitors. Hidden while a saved session is checked. */
const PublicPage: React.FC<PublicPageProps> = ({ children, returnTo }) => {
  const { user, ready } = useAuth();
  const query = returnTo ? `?next=${returnTo}` : '';

  // _document marks a saved session before the first paint. Once it's known to be over, show the page.
  useEffect(() => {
    if (ready && !user) delete document.documentElement.dataset.session;
  }, [ready, user]);

  return (
    <>
      <div data-session-loading className="min-h-screen items-center justify-center text-sm text-medium-gray">
        Loading…
      </div>

      <div data-public-page className="mx-auto flex min-h-screen max-w-page flex-col px-4xl md:px-12xl">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-2xl py-6xl">
          <Logo href="/" />
          <nav className="flex items-center gap-sm sm:gap-lg" aria-label="Main">
            <Button href="/pricing" className="rounded-xl px-lg py-xl text-sm font-medium text-charcoal-gray hover:text-ink sm:px-2xl">
              Pricing
            </Button>
            <Button href={`/login${query}`} className="rounded-xl px-lg py-xl text-sm font-medium text-charcoal-gray hover:text-ink sm:px-2xl">
              Log in
            </Button>
            <Button href={`/register${query}`} variant="primary">
              Sign up
            </Button>
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-light-gray py-8xl text-sm text-medium-gray">
          © Interview Analyzer
        </footer>
      </div>
    </>
  );
};

export default PublicPage;
