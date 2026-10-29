'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowUpDown, ChevronDown, LayoutGrid, List } from 'lucide-react';
import ApplicationList, { type ListView } from './ApplicationList';
import StatCards from './StatCards';
import StatusFilters from './StatusFilters';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { statusOptions } from '@/config/options';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import type { Application, AppStatus } from '@/models/Application';
import type { Option } from '@/models/Common';
import { applicationService } from '@/services/ApplicationService';
import { countByStatus, dateChangeNotice } from '@/utils/application';
import { errorText } from '@/utils/errorText';

type SortKey = 'newest' | 'oldest' | 'company' | 'updated';

const sortOptions: Option<SortKey>[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'company', label: 'Company A–Z' },
  { value: 'updated', label: 'Recently updated' },
];

const byDate = (a: Application, b: Application) => a.date_applied.localeCompare(b.date_applied) || a.id - b.id;

const sorters: Record<SortKey, (a: Application, b: Application) => number> = {
  newest: (a, b) => byDate(b, a),
  oldest: byDate,
  company: (a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }),
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
};

const views: { value: ListView; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'List view', icon: List },
  { value: 'grid', label: 'Grid view', icon: LayoutGrid },
];

const Applications = () => {
  const router = useRouter();
  const { openAddApplication, notify, bump } = useDialogs();
  const [status, setStatus] = useState<AppStatus | ''>('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<ListView>('list');
  const [error, setError] = useState('');

  // The search box in the top bar keeps its query in the URL
  const query = typeof router.query.q === 'string' ? router.query.q.trim() : '';

  // Load everything once and search here (company or role, like the API's ?search=), so the stat
  // cards always cover every application and typing doesn't refetch
  const { data, loading, error: loadError, setData } = useApi('applications', () => applicationService.list());
  const all = data ?? [];
  const needle = query.toLowerCase();
  const matches = needle
    ? all.filter((a) => a.company.toLowerCase().includes(needle) || a.role.toLowerCase().includes(needle))
    : all;
  const shown = (status ? matches.filter((a) => a.status === status) : [...matches]).sort(sorters[sort]);
  const counts = countByStatus(matches);

  const handleStatusChange = async (app: Application, next: AppStatus) => {
    setError('');
    const previous = data;
    const label = statusOptions.find((o) => o.value === next)?.label ?? next;
    setData(all.map((a) => (a.id === app.id ? { ...a, status: next, status_label: label } : a)));
    try {
      const updated = await applicationService.update(app.id, { status: next });
      setData((current) => (current ?? []).map((a) => (a.id === app.id ? updated : a)));
      const notice = dateChangeNotice(app, updated);
      if (notice) notify(notice);
      bump();
    } catch (err) {
      setData(previous);
      setError(errorText(err));
    }
  };

  const handleDelete = async (app: Application) => {
    if (!confirm(`Delete ${app.company} and all its rounds? This can't be undone.`)) return;
    setError('');
    try {
      await applicationService.remove(app.id);
      setData((current) => (current ?? []).filter((a) => a.id !== app.id));
      bump();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-8xl">
      <PageHeader title="Applications" subtitle="Track every job you've applied for, and where it stands." />

      {all.length > 0 && <StatCards applications={all} />}

      <div className="flex flex-wrap items-center justify-between gap-4xl">
        <StatusFilters value={status} counts={counts} total={matches.length} onChange={setStatus} />

        <div className="ml-auto flex items-center gap-lg">
          {/* List or grid */}
          <div className="glass flex rounded-xl p-xs">
            {views.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                onClick={() => setView(value)}
                aria-label={label}
                aria-pressed={view === value}
                className={`rounded-lg p-lg transition-colors ${
                  view === value ? 'bg-white text-ink shadow-card' : 'text-light-silver hover:text-dark-gray'
                }`}
              >
                <Icon size={18} />
              </Button>
            ))}
          </div>

          {/* Sort */}
          <label className="glass relative flex items-center rounded-xl text-sm font-medium text-charcoal-gray">
            <ArrowUpDown size={16} className="pointer-events-none absolute left-2xl" />
            <select
              aria-label="Sort applications"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="cursor-pointer appearance-none rounded-xl bg-transparent py-xl pr-16xl pl-16xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-border"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2xl" />
          </label>
        </div>
      </div>

      <ErrorMessage message={error || loadError} />

      {loading && !data ? (
        <Loading />
      ) : all.length === 0 ? (
        // Empty state
        <Card className="py-16xl text-center">
          <p className="font-serif text-xl font-medium">No applications yet</p>
          <p className="mt-sm text-sm text-medium-gray">Add one in a few seconds: just the company, role and date.</p>
          <Button variant="primary" className="mt-6xl" onClick={() => openAddApplication()}>
            + Add your first application
          </Button>
        </Card>
      ) : shown.length === 0 ? (
        <Loading text="Nothing matches." />
      ) : (
        <ApplicationList applications={shown} view={view} onStatusChange={handleStatusChange} onDelete={handleDelete} />
      )}
    </div>
  );
};

export default Applications;
