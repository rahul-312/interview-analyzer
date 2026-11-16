import React from 'react';

export const ErrorMessage: React.FC<{ message?: string | null; className?: string }> = ({ message, className = '' }) => {
  if (!message) return null;
  return <p className={`rounded-lg bg-rose-pale px-2xl py-lg text-sm text-rose-dark ${className}`}>{message}</p>;
};

export const Loading: React.FC<{ text?: string }> = ({ text = 'Loading…' }) => (
  <p className="text-sm text-medium-gray">{text}</p>
);

/** A small spinning ring, sized to sit inside a button or next to text. */
export const Spinner: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-[1em] w-[1em] shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
  />
);

/** A spinner with a message, for AI jobs that are still running. */
export const Working: React.FC<{ text: string; hint?: string }> = ({
  text,
  hint = 'This can take a few minutes. You can leave this page and come back.',
}) => (
  <div role="status" className="flex items-start gap-2xl text-sm">
    <Spinner className="mt-xs text-primary" />
    <div>
      <p className="font-medium text-dark-gray">{text}</p>
      {hint && <p className="text-xs text-medium-gray">{hint}</p>}
    </div>
  </div>
);

interface JobFailedProps {
  title: string;
  /** The server's reason, already written for the user. */
  reason?: string | null;
  /** The failed run was given back, e.g. "one of your prep plans". */
  refundedWhat?: string | false;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retryTitle?: string;
}

/** A failed AI job: what happened, whether it used anything up, and a way to try again. */
export const JobFailed: React.FC<JobFailedProps> = ({ title, reason, refundedWhat, onRetry, retryDisabled, retryTitle }) => (
  <div className="flex flex-col items-start gap-md rounded-lg bg-rose-pale px-2xl py-xl text-sm">
    <p className="font-medium text-rose-dark">{title}</p>
    {reason && <p className="text-dark-gray">{reason}</p>}
    {refundedWhat && <p className="text-deep-green">This didn&apos;t use up {refundedWhat}.</p>}
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        disabled={retryDisabled}
        title={retryTitle}
        className="mt-sm cursor-pointer font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        Try again
      </button>
    )}
  </div>
);
