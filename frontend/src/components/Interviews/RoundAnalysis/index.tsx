'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AnalysisResult from './AnalysisResult';
import DebriefSummary from './DebriefSummary';
import NotAnalysed from './NotAnalysed';
import { OutcomeBadge } from '../../Badges';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { ErrorMessage, Loading, Working } from '../../ui/Feedback';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import { useUsage } from '@/hooks/useUsage';
import { roundService } from '@/services/RoundService';
import { isAnalysing } from '@/utils/analysis';
import { errorText } from '@/utils/errorText';
import { formatDateTime } from '@/utils/format';

interface RoundAnalysisProps {
  id: string;
}

const RoundAnalysis: React.FC<RoundAnalysisProps> = ({ id }) => {
  const router = useRouter();
  const { openRoundForm, bump } = useDialogs();
  const [error, setError] = useState('');
  // Poll until the analysis is done
  const { data: round, error: loadError, reload } = useApi(`round-${id}`, () => roundService.get(id), isAnalysing);
  const { usage } = useUsage();
  const outOfAnalyses = usage?.remaining === 0;

  const handleAnalyse = async () => {
    setError('');
    try {
      await roundService.analyze(id);
      bump(); // reloads this round and the usage count
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this round and its debrief?')) return;
    try {
      await roundService.remove(id);
      bump();
      router.push('/interviews');
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (loadError) return <ErrorMessage message={loadError} />;
  if (!round) return <Loading />;

  const analysis = round.analysis;
  const analysing = isAnalysing(round);

  return (
    <div className="flex flex-col gap-8xl">
      <Button href="/interviews" className="self-start text-sm text-medium-gray hover:text-ink">
        ← Interviews
      </Button>

      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-2xl">
        <div>
          <div className="flex items-center gap-lg">
            <h1 className="text-2xl font-semibold">{round.round_type_label}</h1>
            <OutcomeBadge outcome={round.outcome} />
          </div>
          <p className="text-dark-gray">
            <Link href={`/applications/${round.application}`} className="hover:underline">
              {round.company}
            </Link>{' '}
            · {round.role} · {formatDateTime(round.scheduled_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-lg">
          {round.debrief && analysis && (
            <Button
              variant="secondary"
              onClick={handleAnalyse}
              disabled={analysing || outOfAnalyses}
              title={outOfAnalyses ? 'No analyses left today on the free plan' : undefined}
            >
              Re-analyse
            </Button>
          )}
          <Button variant="secondary" onClick={() => openRoundForm({ round, withDebrief: true, afterSave: reload })}>
            {round.debrief ? 'Edit debrief' : 'Write debrief'}
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      <ErrorMessage message={error} />

      {/* Analysis */}
      {!round.debrief ? (
        <Card className="text-sm text-medium-gray">No debrief yet. Write one to get an analysis of this round.</Card>
      ) : !analysis ? (
        <NotAnalysed usage={usage} onAnalyse={handleAnalyse} />
      ) : analysing ? (
        <Card>
          <Working text={analysis.status === 'running' ? 'Analysing your debrief…' : 'Queued for analysis…'} />
        </Card>
      ) : analysis.status === 'failed' ? (
        <Card className="flex flex-col items-start gap-lg text-sm">
          <p className="font-medium text-rose-dark">The analysis failed.</p>
          <p className="text-dark-gray">{analysis.error}</p>
          <Button variant="primary" onClick={handleAnalyse} disabled={outOfAnalyses}>
            Try again
          </Button>
        </Card>
      ) : (
        <AnalysisResult analysis={analysis} />
      )}

      {round.debrief && <DebriefSummary debrief={round.debrief} />}
    </div>
  );
};

export default RoundAnalysis;
