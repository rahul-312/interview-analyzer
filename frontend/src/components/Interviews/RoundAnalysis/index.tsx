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
import { useRefreshUsageWhenDone, useUsage } from '@/hooks/useUsage';
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
  const { usage, reloadUsage } = useUsage();
  const outOfAnalyses = usage?.analyses.remaining === 0;
  // A refunded (failed) analysis changes the count, so refresh it when the job finishes
  useRefreshUsageWhenDone(round ? isAnalysing(round) : false);

  const handleAnalyse = async () => {
    setError('');
    try {
      await roundService.analyze(id);
    } catch (err) {
      setError(errorText(err));
    }
    // Reload either way: a 409/429 means the round or usage changed elsewhere
    reload();
    reloadUsage();
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
          {round.debrief && analysis && !analysis.stale && (
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
          {analysis.refunded && (
            <p className="rounded-lg bg-pale-mint px-2xl py-lg text-deep-green">
              This one didn&apos;t count towards your limit.
            </p>
          )}
          <Button variant="primary" onClick={handleAnalyse} disabled={outOfAnalyses}>
            Try again
          </Button>
        </Card>
      ) : analysis.stale ? (
        <>
          <NotAnalysed usage={usage} stale onAnalyse={handleAnalyse} />
          <details className="flex flex-col gap-8xl">
            <summary className="cursor-pointer text-sm font-medium text-medium-gray">
              Show the previous analysis (before your last edit)
            </summary>
            <div className="mt-6xl flex flex-col gap-8xl opacity-75">
              <AnalysisResult analysis={analysis} />
            </div>
          </details>
        </>
      ) : (
        <AnalysisResult analysis={analysis} />
      )}

      {round.debrief && <DebriefSummary debrief={round.debrief} />}
    </div>
  );
};

export default RoundAnalysis;
