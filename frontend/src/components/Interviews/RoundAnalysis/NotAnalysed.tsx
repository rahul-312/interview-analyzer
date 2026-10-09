'use client';

import React from 'react';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import type { Usage } from '@/models/Auth';
import { formatDateTime } from '@/utils/format';

interface NotAnalysedProps {
  usage: Usage | null;
  onAnalyse: () => void;
}

/** A saved debrief with no analysis yet, usually because the daily limit was reached. */
const NotAnalysed: React.FC<NotAnalysedProps> = ({ usage, onAnalyse }) => {
  const outOfAnalyses = usage?.remaining === 0;

  return (
    <Card className="flex flex-col items-start gap-lg text-sm">
      <p className="font-medium">This debrief hasn&apos;t been analysed yet.</p>
      {outOfAnalyses ? (
        <p className="text-dark-gray">
          You&apos;ve used all {usage?.limit} analyses for today on the free plan.
          {usage?.next_available_at && <> The next one frees up at {formatDateTime(usage.next_available_at)}.</>}
        </p>
      ) : (
        <p className="text-dark-gray">
          Your debrief is saved.
          {usage?.remaining != null && ` You have ${usage.remaining} of ${usage.limit} analyses left today.`}
        </p>
      )}
      <Button variant="primary" onClick={onAnalyse} disabled={outOfAnalyses}>
        Analyse now
      </Button>
    </Card>
  );
};

export default NotAnalysed;
