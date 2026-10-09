'use client';

import React from 'react';
import { AnalysisBadge, OutcomeBadge } from '../Badges';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { useDialogs } from '@/context/DialogsContext';
import type { InterviewRound } from '@/models/Interview';
import { formatDateTime } from '@/utils/format';

/** Past rounds, with a "need a debrief" counter and "Write debrief" buttons. */
const PastRounds: React.FC<{ rounds: InterviewRound[] }> = ({ rounds }) => {
  const { openRoundForm } = useDialogs();
  const needDebrief = rounds.filter((r) => !r.debrief).length;

  return (
    <section className="flex flex-col gap-2xl">
      {/* Heading */}
      <div className="flex items-center gap-lg">
        <h2 className="text-lg font-semibold">Past</h2>
        {needDebrief > 0 && (
          <span className="rounded-full bg-amber-light px-lg py-xs text-xs font-medium text-amber-dark">
            {needDebrief} need{needDebrief === 1 ? 's' : ''} a debrief
          </span>
        )}
      </div>

      {/* Rounds */}
      {rounds.length === 0 ? (
        <Card className="text-sm text-medium-gray">No past rounds yet.</Card>
      ) : (
        <ul className="divide-y divide-light-gray overflow-hidden rounded-xl border border-light-gray bg-white">
          {rounds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2xl px-4xl py-2xl">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-lg">
                  <span className="font-medium">{r.company}</span>
                  <span className="text-sm text-medium-gray">{r.round_type_label}</span>
                  <OutcomeBadge outcome={r.outcome} />
                  <AnalysisBadge analysis={r.analysis} hasDebrief={Boolean(r.debrief)} />
                </div>
                <p className="text-sm text-medium-gray">{formatDateTime(r.scheduled_at)}</p>
              </div>
              {r.debrief ? (
                <Button variant="secondary" href={`/interviews/${r.id}`}>
                  View analysis
                </Button>
              ) : (
                <Button variant="primary" onClick={() => openRoundForm({ round: r, withDebrief: true })}>
                  Write debrief
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default PastRounds;
