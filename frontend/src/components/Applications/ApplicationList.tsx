'use client';

import React from 'react';
import ApplicationCard from './ApplicationCard';
import type { Application, AppStatus } from '@/models/Application';

export type ListView = 'list' | 'grid';

interface ApplicationListProps {
  applications: Application[];
  view: ListView;
  onStatusChange: (app: Application, status: AppStatus) => void;
  onDelete: (app: Application) => void;
}

/** Application cards, one per row or in a two-column grid. */
const ApplicationList: React.FC<ApplicationListProps> = ({ applications, view, onStatusChange, onDelete }) => {
  return (
    <ul className={view === 'grid' ? 'grid gap-4xl md:grid-cols-2' : 'flex flex-col gap-4xl'}>
      {applications.map((app) => (
        <ApplicationCard
          key={app.id}
          app={app}
          stacked={view === 'grid'}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
};

export default ApplicationList;
