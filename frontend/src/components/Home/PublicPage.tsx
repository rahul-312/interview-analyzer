import React from 'react';
import Logo from '../Logo';
import Button from '../ui/Button';

/** The top bar and footer around pages for logged-out visitors. */
const PublicPage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="mx-auto flex min-h-screen max-w-page flex-col px-4xl md:px-12xl">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-2xl py-6xl">
        <Logo href="/" />
        <nav className="flex items-center gap-sm sm:gap-lg" aria-label="Main">
          <Button href="/pricing" className="rounded-xl px-lg py-xl text-sm font-medium text-charcoal-gray hover:text-ink sm:px-2xl">
            Pricing
          </Button>
          <Button href="/login" className="rounded-xl px-lg py-xl text-sm font-medium text-charcoal-gray hover:text-ink sm:px-2xl">
            Log in
          </Button>
          <Button href="/register" variant="primary">
            Sign up
          </Button>
        </nav>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-light-gray py-8xl text-sm text-medium-gray">
        © {new Date().getFullYear()} Interview Analyzer
      </footer>
    </div>
  );
};

export default PublicPage;
