'use client';

import React from 'react';
import Link from 'next/link';
import { StatusBadge } from '../Badges';
import { Select } from '../ui/FormControls';
import { statusOptions } from '@/config/options';
import type { Application, AppStatus } from '@/models/Application';
import { formatDate } from '@/utils/format';

interface ApplicationListProps {
  applications: Application[];
  onStatusChange: (app: Application, status: AppStatus) => void;
}

/** Applications with a status badge and an inline status dropdown. */
const ApplicationList: React.FC<ApplicationListProps> = ({ applications, onStatusChange }) => {
  return (
    <ul className="divide-y divide-light-gray overflow-hidden rounded-xl border border-light-gray bg-white">
      {applications.map((app) => (
        <li key={app.id} className="flex flex-wrap items-center gap-2xl px-4xl py-2xl hover:bg-page-bg">
          <Link href={`/applications/${app.id}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-lg">
              <span className="truncate font-medium">{app.company}</span>
              <StatusBadge status={app.status} label={app.status_label} />
            </div>
            <div className="truncate text-sm text-medium-gray">
              {app.role} · {app.applied_at ? 'applied' : 'saved'} {formatDate(app.date_applied)}
              {app.rounds_count > 0 && ` · ${app.rounds_count} round${app.rounds_count === 1 ? '' : 's'}`}
            </div>
          </Link>
          <div className="w-auto">
            <Select
              aria-label={`Status for ${app.company}`}
              className="py-md"
              value={app.status}
              onChange={(e) => onStatusChange(app, e.target.value as AppStatus)}
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </li>
      ))}
    </ul>
  );
};

export default ApplicationList;
