'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { StatusBadge } from '../../Badges';
import Button from '../../ui/Button';
import { sourceOptions } from '@/config/options';
import type { Application } from '@/models/Application';
import { formatDate } from '@/utils/format';

interface ApplicationInfoProps {
  app: Application;
  onEdit: () => void;
  onDelete: () => void;
}

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  if (!children) return null;
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-medium-gray uppercase">{label}</dt>
      <dd className="mt-xs text-sm wrap-break-word whitespace-pre-line">{children}</dd>
    </div>
  );
};

/** The application's details, with Edit and Delete. */
const ApplicationInfo: React.FC<ApplicationInfoProps> = ({ app, onEdit, onDelete }) => {
  const sourceLabel = app.source && sourceOptions.find((o) => o.value === app.source)?.label;

  return (
    <>
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-2xl">
        <div>
          <div className="flex items-center gap-lg">
            <h1 className="text-2xl font-semibold">{app.company}</h1>
            <StatusBadge status={app.status} label={app.status_label} />
          </div>
          <p className="text-dark-gray">{app.role}</p>
        </div>
        <div className="flex gap-lg">
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/* Details */}
      <dl className="mt-6xl grid gap-4xl md:grid-cols-3">
        <Detail label="Applied">{formatDate(app.date_applied)}</Detail>
        <Detail label="Source">{sourceLabel}</Detail>
        <Detail label="Salary">{app.salary}</Detail>
        <Detail label="Contact">{app.contact}</Detail>
        <Detail label="Job link">
          {app.job_url && (
            <a
              href={app.job_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-sm text-primary hover:underline"
            >
              Open posting <ExternalLink size={14} />
            </a>
          )}
        </Detail>
      </dl>

      {/* Notes and job description */}
      {(app.notes || app.job_description) && (
        <dl className="mt-4xl flex flex-col gap-4xl border-t border-smoke-white pt-4xl">
          <Detail label="Notes">{app.notes}</Detail>
          {app.job_description && (
            <details>
              <summary className="cursor-pointer text-xs font-medium tracking-wide text-medium-gray uppercase">
                Job description
              </summary>
              <p className="mt-lg text-sm whitespace-pre-line text-charcoal-gray">{app.job_description}</p>
            </details>
          )}
        </dl>
      )}
    </>
  );
};

export default ApplicationInfo;
