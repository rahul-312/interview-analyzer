'use client';

import React from 'react';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import type { Usage } from '@/models/Auth';
import { formatDateTime, planLabel } from '@/utils/format';

interface NotAnalysedProps {
  usage: Usage | null;
  /** There is an analysis, but of an earlier version of the debrief. */
  stale?: boolean;
  onAnalyse: () => void;
}

/** A saved debrief with no current analysis, usually because the plan's limit was reached. */
const NotAnalysed: React.FC<NotAnalysedProps> = ({ usage, stale = false, onAnalyse }) => {
  const quota = usage?.analyses;
  const outOfAnalyses = quota?.remaining === 0;
  const planName = planLabel(usage?.plan);

  return (
    <Card className="flex flex-col items-start gap-lg border-amber-light text-sm">
      <p className="font-medium">
        {stale
          ? 'You changed this debrief after it was analysed, so the analysis below is out of date.'
          : "This debrief hasn't been analysed yet."}
      </p>
      {outOfAnalyses ? (
        <p className="text-dark-gray">
          You&apos;ve used all {quota?.limit} analyses allowed in 24 hours on the {planName} plan.
          {quota?.next_available_at && <> The next one frees up at {formatDateTime(quota.next_available_at)}.</>}
        </p>
      ) : (
        <p className="text-dark-gray">
          Your debrief is saved.
          {quota?.remaining != null && ` You have ${quota.remaining} of ${quota.limit} analyses left.`}
        </p>
      )}
      <Button variant="primary" onClick={onAnalyse} disabled={outOfAnalyses}>
        {stale ? 'Analyse again' : 'Analyse now'}
      </Button>
    </Card>
  );
};

export default NotAnalysed;
