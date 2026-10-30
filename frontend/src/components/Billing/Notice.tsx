import React from 'react';

const tones = {
  info: 'bg-sky-light text-sky-dark',
  warn: 'bg-amber-light text-amber-dark',
  error: 'bg-rose-pale text-rose-dark',
  success: 'bg-pale-mint text-deep-green',
};

interface NoticeProps {
  tone: keyof typeof tones;
  children: React.ReactNode;
  action?: React.ReactNode;
}

/** A coloured message strip, with an optional action on the right. Announced to screen readers. */
const Notice: React.FC<NoticeProps> = ({ tone, children, action }) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`flex flex-wrap items-center justify-between gap-2xl rounded-xl px-4xl py-2xl text-sm ${tones[tone]}`}
  >
    <p>{children}</p>
    {action}
  </div>
);

export default Notice;
