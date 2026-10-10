'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import ApplicationInfo from './ApplicationInfo';
import RoundsSection from './RoundsSection';
import ApplicationForm from '../../ApplicationForm';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { ErrorMessage, Loading } from '../../ui/Feedback';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import { useRefreshUsageWhenDone } from '@/hooks/useUsage';
import { applicationService } from '@/services/ApplicationService';
import { roundService } from '@/services/RoundService';
import { anyAnalysing } from '@/utils/analysis';
import { dateChangeNotice } from '@/utils/application';
import { errorText } from '@/utils/errorText';

interface ApplicationDetailProps {
  id: string;
}

const ApplicationDetail: React.FC<ApplicationDetailProps> = ({ id }) => {
  const router = useRouter();
  const { notify, bump } = useDialogs();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const { data: app, error: loadError, setData } = useApi(`application-${id}`, () => applicationService.get(id));
  const { data: rounds } = useApi(`rounds-${id}`, () => roundService.list(id), anyAnalysing);
  useRefreshUsageWhenDone(anyAnalysing(rounds ?? []));

  const handleDelete = async () => {
    if (!app || !confirm(`Delete ${app.company} and all its rounds? This can't be undone.`)) return;
    try {
      await applicationService.remove(app.id);
      bump();
      router.push('/applications');
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (loadError) return <ErrorMessage message={loadError} />;
  if (!app) return <Loading />;

  return (
    <div className="flex flex-col gap-8xl">
      <Button href="/applications" className="self-start text-sm text-medium-gray hover:text-ink">
        ← Applications
      </Button>

      <Card>
        {editing ? (
          <ApplicationForm
            initial={app}
            onCancel={() => setEditing(false)}
            onSaved={(saved, sent) => {
              const notice = dateChangeNotice(app, saved, sent.date_applied);
              if (notice) notify(notice);
              setData(saved);
              setEditing(false);
              bump();
            }}
          />
        ) : (
          <ApplicationInfo app={app} onEdit={() => setEditing(true)} onDelete={handleDelete} />
        )}
        <ErrorMessage message={error} className="mt-2xl" />
      </Card>

      <RoundsSection applicationId={app.id} rounds={rounds ?? []} />
    </div>
  );
};

export default ApplicationDetail;
