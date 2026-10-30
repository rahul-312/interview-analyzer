'use client';

import React, { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CircleSlash, Ellipsis, ExternalLink, MessagesSquare, Trash2, Wallet } from 'lucide-react';
import { statusStyles } from '../Badges';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import { sourceOptions, statusOptions } from '@/config/options';
import { useDismiss } from '@/hooks/useDismiss';
import type { Application, AppStatus } from '@/models/Application';
import { formatDate } from '@/utils/format';

interface ApplicationCardProps {
  app: Application;
  /** Stack the details above the status, for the grid view. */
  stacked?: boolean;
  onStatusChange: (app: Application, status: AppStatus) => void;
  onDelete: (app: Application) => void;
}

/** The steps an application moves through, in order. */
const stages: { status: AppStatus; label: string }[] = [
  { status: 'applied', label: 'Applied' },
  { status: 'screening', label: 'Screening' },
  { status: 'interview', label: 'Interview' },
  { status: 'offer', label: 'Offer' },
];

/** The company's initial on a tile, standing in for a logo. */
const CompanyMark: React.FC<{ name: string }> = ({ name }) => (
  <span className="flex size-20xl shrink-0 items-center justify-center glass rounded-2xl bg-white/80 font-serif text-2xl font-semibold text-ink md:size-[4.5rem] md:text-3xl">
    {name.trim()[0]?.toUpperCase() ?? '?'}
  </span>
);

/** The status as a coloured pill that opens the list of statuses. */
const StatusPicker: React.FC<{ app: Application; onChange: (status: AppStatus) => void }> = ({ app, onChange }) => (
  <Dropdown
    label={`Status for ${app.company}`}
    value={app.status}
    options={statusOptions}
    onChange={onChange}
    align="left"
    icon={<span className="size-lg rounded-full bg-current" />}
    optionIcon={(status) => <StatusDot status={status} />}
    buttonClassName={`rounded-full px-2xl py-md ${statusStyles[app.status]}`}
  />
);

/** The status's pill colour as a small swatch, for the options in the status menu. */
const StatusDot: React.FC<{ status: AppStatus }> = ({ status }) => (
  <span className={`flex size-4xl items-center justify-center rounded-full ${statusStyles[status]}`}>
    <span className="size-sm rounded-full bg-current" />
  </span>
);

/** Applied → Screening → Interview → Offer, filled up to the current step. Closed applications say so instead. */
const StatusTrack: React.FC<{ app: Application }> = ({ app }) => {
  if (app.status === 'rejected' || app.status === 'withdrawn') {
    return (
      <p className="flex items-center gap-md text-sm text-medium-gray">
        <CircleSlash size={16} />
        {app.status === 'rejected' ? 'Rejected' : 'Withdrawn'}, no longer in progress
      </p>
    );
  }

  const reached = stages.findIndex((s) => s.status === app.status);
  return (
    <ol className="grid grid-cols-4" aria-label="Progress">
      {stages.map((stage, i) => {
        const done = i <= reached;
        return (
          <li key={stage.status} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[7px] right-1/2 z-0 h-0.5 w-full ${done ? 'bg-primary' : 'bg-light-gray'}`}
              />
            )}
            <span
              className={`relative z-10 size-4xl rounded-full border-2 ${
                done ? 'border-primary bg-primary' : 'border-input-border bg-white'
              } ${i === reached ? 'ring-4 ring-primary-light' : ''}`}
            />
            <span className={`mt-md text-xs ${done ? 'font-medium text-ink' : 'text-medium-gray'}`}>
              {stage.label}
              {i === reached && <span className="sr-only"> (current)</span>}
            </span>
            {i === 0 && app.applied_at && <span className="text-xxs text-light-silver">{formatDate(app.applied_at)}</span>}
          </li>
        );
      })}
    </ol>
  );
};

const ActionsMenu: React.FC<{ app: Application; onDelete: () => void }> = ({ app, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const item = 'flex w-full items-center gap-lg rounded-lg px-xl py-lg text-sm text-charcoal-gray hover:bg-smoke-white';

  // Escape closes it (via useDismiss) and puts focus back on the button
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) ref.current?.querySelector('button')?.focus();
  };

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <Button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`More for ${app.company}`}
        className="rounded-lg p-sm text-medium-gray hover:bg-smoke-white hover:text-ink"
      >
        <Ellipsis size={20} />
      </Button>

      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-sm w-48 rounded-xl border border-light-gray bg-white p-sm shadow-lg"
        >
          <Link href={`/applications/${app.id}`} className={item}>
            <ExternalLink size={16} /> Open
          </Link>
          <Button
            onClick={() => {
              close();
              onDelete();
            }}
            className={`${item} hover:text-crimson-red`}
          >
            <Trash2 size={16} /> Delete
          </Button>
        </div>
      )}
    </div>
  );
};

/** One application: company and details on the left, its status and progress on the right. */
const ApplicationCard: React.FC<ApplicationCardProps> = ({ app, stacked = false, onStatusChange, onDelete }) => {
  const source = app.source ? sourceOptions.find((o) => o.value === app.source) : undefined;

  return (
    <li
      className={`glass relative flex flex-col gap-6xl rounded-2xl p-6xl transition-colors hover:bg-white/70 has-[[aria-expanded=true]]:z-10 ${
        stacked ? '' : 'lg:flex-row lg:items-center lg:gap-12xl'
      }`}
    >
      <Link href={`/applications/${app.id}`} className="flex min-w-0 flex-1 items-start gap-6xl">
        <CompanyMark name={app.company} />
        <div className="min-w-0">
          <p className="truncate font-serif text-xl font-medium">{app.company}</p>
          <p className="truncate text-dark-gray">{app.role}</p>
          <div className="mt-lg flex flex-wrap gap-x-4xl gap-y-sm text-sm text-medium-gray">
            <span className="flex items-center gap-md">
              <CalendarDays size={16} />
              {app.applied_at ? 'Applied' : 'Saved'} {formatDate(app.date_applied)}
            </span>
            {app.rounds_count > 0 && (
              <span className="flex items-center gap-md">
                <MessagesSquare size={16} />
                {app.rounds_count} round{app.rounds_count === 1 ? '' : 's'}
              </span>
            )}
            {app.salary && (
              <span className="flex items-center gap-md">
                <Wallet size={16} />
                {app.salary}
              </span>
            )}
          </div>
          {source && (
            <span className="mt-2xl inline-block rounded-full bg-white/70 px-xl py-xs text-xs text-dark-gray">
              {source.label}
            </span>
          )}
        </div>
      </Link>

      <div className={`flex flex-col gap-4xl ${stacked ? '' : 'lg:w-[22rem] lg:shrink-0'}`}>
        <div className="flex items-center justify-between gap-2xl">
          <StatusPicker app={app} onChange={(status) => onStatusChange(app, status)} />
          <ActionsMenu app={app} onDelete={() => onDelete(app)} />
        </div>
        <StatusTrack app={app} />
      </div>
    </li>
  );
};

export default ApplicationCard;
