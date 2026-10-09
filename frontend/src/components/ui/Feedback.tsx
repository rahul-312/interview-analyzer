import React from 'react';

export const ErrorMessage: React.FC<{ message?: string | null; className?: string }> = ({ message, className = '' }) => {
  if (!message) return null;
  return <p className={`rounded-lg bg-rose-pale px-2xl py-lg text-sm text-rose-dark ${className}`}>{message}</p>;
};

export const Loading: React.FC<{ text?: string }> = ({ text = 'Loading…' }) => (
  <p className="text-sm text-medium-gray">{text}</p>
);

/** A pulsing dot with a message, for background jobs that are still running. */
export const Working: React.FC<{ text: string }> = ({ text }) => (
  <p className="flex items-center gap-2xl text-sm text-dark-gray">
    <span className="h-2xl w-2xl animate-ping rounded-full bg-primary" />
    {text}
  </p>
);
