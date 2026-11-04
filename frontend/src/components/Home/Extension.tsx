import React from 'react';
import { Plus } from 'lucide-react';
import Button from '../ui/Button';
import Card from '../ui/Card';

/** The browser extension, with a sketch of its button on a job card. The install link shows once it's published. */
const Extension: React.FC = () => {
  const installUrl = process.env.NEXT_PUBLIC_EXTENSION_URL;

  return (
    <section className="grid items-center gap-12xl border-t border-light-gray py-20xl lg:grid-cols-2 lg:gap-20xl lg:py-section">
      <div className="flex flex-col gap-2xl">
        <h2 className="font-serif text-heading font-medium tracking-tight md:text-title">
          Save jobs without leaving the job site
        </h2>
        <p className="max-w-modal text-dark-gray">
          The browser extension adds a Track button to job listings on job sites and company careers pages. Click it and
          the application opens already filled in. It works in Chrome, Edge and Brave.
        </p>
        {installUrl && (
          <Button href={installUrl} target="_blank" variant="secondary" className="mt-sm self-start">
            Install the extension
          </Button>
        )}
      </div>

      <Card className="flex items-center justify-between gap-4xl" aria-hidden>
        <div className="min-w-0">
          <p className="font-medium">Backend Engineer</p>
          <p className="mt-xs text-sm text-medium-gray">Remote · Full-time</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-sm rounded-xl bg-primary px-2xl py-lg text-sm font-medium text-white">
          <Plus size={16} />
          Track
        </span>
      </Card>
    </section>
  );
};

export default Extension;
