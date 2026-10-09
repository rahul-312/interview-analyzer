'use client';

import React from 'react';
import PastRounds from './PastRounds';
import UpcomingRounds from './UpcomingRounds';
import Button from '../ui/Button';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import { roundService } from '@/services/RoundService';
import { anyAnalysing } from '@/utils/analysis';
import { isPast } from '@/utils/format';

const Interviews = () => {
  const { openRoundForm } = useDialogs();
  // Poll while any analysis is queued or running
  const { data, loading, error } = useApi('rounds', () => roundService.list(), anyAnalysing);

  const rounds = data ?? [];
  const upcoming = rounds
    .filter((r) => !isPast(r.scheduled_at))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = rounds.filter((r) => isPast(r.scheduled_at));

  return (
    <div className="flex flex-col gap-12xl">
      <PageHeader
        title="Interviews"
        subtitle="Upcoming rounds to prep for, and past rounds to debrief."
        actions={
          <Button variant="secondary" onClick={() => openRoundForm()}>
            + Log round
          </Button>
        }
      />

      <ErrorMessage message={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <UpcomingRounds rounds={upcoming} />
          <PastRounds rounds={past} />
        </>
      )}
    </div>
  );
};

export default Interviews;
