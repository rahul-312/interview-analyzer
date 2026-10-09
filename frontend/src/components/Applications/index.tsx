'use client';

import React, { useEffect, useState } from 'react';
import ApplicationList from './ApplicationList';
import StatusFilters from './StatusFilters';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage, Loading } from '../ui/Feedback';
import { Input } from '../ui/FormControls';
import PageHeader from '../ui/PageHeader';
import { statusOptions } from '@/config/options';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import type { Application, AppStatus } from '@/models/Application';
import { applicationService } from '@/services/ApplicationService';
import { errorText } from '@/utils/errorText';

const Applications = () => {
  const { openAddApplication, bump } = useDialogs();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AppStatus | ''>('');
  const [error, setError] = useState('');

  // Debounce the search box so we don't hit the API on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error: loadError, setData } = useApi(`applications?${query}`, () =>
    applicationService.list({ search: query })
  );
  const all = data ?? [];
  const shown = status ? all.filter((a) => a.status === status) : all;
  const counts = all.reduce<Partial<Record<AppStatus, number>>>(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    {}
  );

  const handleStatusChange = async (app: Application, next: AppStatus) => {
    setError('');
    const previous = data;
    const label = statusOptions.find((o) => o.value === next)?.label ?? next;
    setData(all.map((a) => (a.id === app.id ? { ...a, status: next, status_label: label } : a)));
    try {
      await applicationService.update(app.id, { status: next });
      bump();
    } catch (err) {
      setData(previous);
      setError(errorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-6xl">
      <PageHeader
        title="Applications"
        subtitle="Every job you've applied for, and where it stands."
        actions={
          <div className="w-full md:w-search">
            <Input
              type="search"
              placeholder="Search company or role"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />

      <StatusFilters value={status} counts={counts} total={all.length} onChange={setStatus} />

      <ErrorMessage message={error || loadError} />

      {loading && !data ? (
        <Loading />
      ) : all.length === 0 && !query ? (
        // Empty state
        <Card className="py-16xl text-center">
          <p className="text-lg font-medium">No applications yet</p>
          <p className="mt-sm text-sm text-medium-gray">Add one in a few seconds: just the company, role and date.</p>
          <Button variant="primary" className="mt-6xl" onClick={() => openAddApplication()}>
            + Add your first application
          </Button>
        </Card>
      ) : shown.length === 0 ? (
        <Loading text="Nothing matches." />
      ) : (
        <ApplicationList applications={shown} onStatusChange={handleStatusChange} />
      )}
    </div>
  );
};

export default Applications;
