'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import Extension from './Extension';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import PublicPage from './PublicPage';
import Button from '../ui/Button';
import { useAuth } from '@/context/AuthContext';

/** The public landing page. Anyone with a session goes straight to the app. */
const Home: React.FC = () => {
  const router = useRouter();
  const { user, ready } = useAuth();

  // _document hides this page while there's a saved session, so show it if the session turns out to be over
  useEffect(() => {
    if (!ready) return;
    if (user) router.replace('/applications');
    else delete document.documentElement.dataset.session;
  }, [ready, user, router]);

  return (
    <>
      <div data-session-loading className="min-h-screen items-center justify-center text-sm text-medium-gray">
        Loading…
      </div>

      <div data-landing>
        <PublicPage>
          <Hero />
          <HowItWorks />
          <Extension />

          {/* Closing call to action */}
          <section className="flex flex-col items-center gap-6xl border-t border-light-gray py-20xl text-center lg:py-section">
            <h2 className="max-w-modal-wide font-serif text-heading font-medium tracking-tight md:text-title">
              Make your next interview better than your last.
            </h2>
            <Button href="/register" variant="primary">
              Create a free account
            </Button>
          </section>
        </PublicPage>
      </div>
    </>
  );
};

export default Home;
