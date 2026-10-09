'use client';

import React from 'react';
import { AnalysisBadge, OutcomeBadge } from '../../Badges';
import Button from '../../ui/Button';
import Card from '../../ui/Card';
import { useDialogs } from '@/context/DialogsContext';
import type { InterviewRound } from '@/models/Interview';
import { formatDateTime, isPast } from '@/utils/format';

interface RoundsSectionProps {
  applicationId: number;
  rounds: InterviewRound[];
}

/** The application's rounds, with "+ Log round" and "Make a prep plan". */
const RoundsSection: React.FC<RoundsSectionProps> = ({ applicationId, rounds }) => {
  const { openRoundForm } = useDialogs();

  return (
    <section className="flex flex-col gap-2xl">
      {/* Heading */}
      <div className="flex flex-wrap items-center justify-between gap-lg">
        <h2 className="text-lg font-semibold">Interview rounds</h2>
        <div className="flex gap-lg">
          <Button variant="secondary" href={`/prep?new=${applicationId}`}>
            Make a prep plan
          </Button>
          <Button variant="primary" onClick={() => openRoundForm({ applicationId })}>
            + Log round
          </Button>
        </div>
      </div>

      {/* Rounds */}
      {rounds.length === 0 ? (
        <Card className="text-sm text-medium-gray">No rounds logged yet. Log one when an interview is scheduled.</Card>
      ) : (
        <ul className="divide-y divide-light-gray overflow-hidden rounded-xl border border-light-gray bg-white">
          {rounds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2xl px-4xl py-2xl">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-lg">
                  <span className="font-medium">{r.round_type_label}</span>
                  <OutcomeBadge outcome={r.outcome} />
                  <AnalysisBadge analysis={r.analysis} hasDebrief={Boolean(r.debrief)} />
                </div>
                <div className="text-sm text-medium-gray">
                  {formatDateTime(r.scheduled_at)}
                  {r.interviewer && ` · ${r.interviewer}`}
                </div>
              </div>
              <div className="flex gap-lg">
                {r.debrief ? (
                  <Button variant="secondary" href={`/interviews/${r.id}`}>
                    View analysis
                  </Button>
                ) : isPast(r.scheduled_at) ? (
                  <Button variant="primary" onClick={() => openRoundForm({ round: r, withDebrief: true })}>
                    Write debrief
                  </Button>
                ) : (
                  <Button variant="secondary" href={`/prep?new=${applicationId}&round=${r.id}`}>
                    Prep plan
                  </Button>
                )}
                <Button variant="secondary" onClick={() => openRoundForm({ round: r })}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default RoundsSection;
