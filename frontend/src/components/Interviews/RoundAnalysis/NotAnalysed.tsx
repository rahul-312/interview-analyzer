'use client';

import React from 'react';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import type { Usage } from '@/models/Auth';
import { formatDateTime } from '@/utils/format';

interface NotAnalysedProps {
  usage: Usage | null;
  /** There is an analysis, but of an earlier version of the debrief. */
  stale?: boolean;
  onAnalyse: () => void;
}

/** A saved debrief with no current analysis, usually because the plan's limit was reached. */
const NotAnalysed: React.FC<NotAnalysedProps> = ({ usage, stale = false, onAnalyse }) => {
  const outOfAnalyses = usage?.remaining === 0;
  const planName = usage?.plan === 'pro' ? 'Pro' : 'Free';

  return (
    <Card className="flex flex-col items-start gap-lg border-amber-light text-sm">
      <p className="font-medium">
        {stale
          ? 'You changed this debrief after it was analysed, so the analysis below is out of date.'
          : "This debrief hasn't been analysed yet."}
      </p>
      {outOfAnalyses ? (
        <p className="text-dark-gray">
          You&apos;ve used all {usage?.limit} analyses allowed in 24 hours on the {planName} plan.
          {usage?.next_available_at && <> The next one frees up at {formatDateTime(usage.next_available_at)}.</>}
        </p>
      ) : (
        <p className="text-dark-gray">
          Your debrief is saved.
          {usage?.remaining != null && ` You have ${usage.remaining} of ${usage.limit} analyses left.`}
        </p>
      )}
      <Button variant="primary" onClick={onAnalyse} disabled={outOfAnalyses}>
        {stale ? 'Analyse again' : 'Analyse now'}
      </Button>
    </Card>
  );
};

export default NotAnalysed;
