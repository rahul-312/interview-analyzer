'use client';

import React from 'react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { useDialogs } from '@/context/DialogsContext';
import type { InterviewRound } from '@/models/Interview';
import { daysUntil, formatDateTime, inDays } from '@/utils/format';

/** Upcoming rounds with an "in N days" label and a link to make a prep plan. */
const UpcomingRounds: React.FC<{ rounds: InterviewRound[] }> = ({ rounds }) => {
  const { openRoundForm } = useDialogs();

  return (
    <section className="flex flex-col gap-2xl">
      <h2 className="text-lg font-semibold">Upcoming</h2>

      {rounds.length === 0 ? (
        <Card className="text-sm text-medium-gray">Nothing scheduled. Log a round when you get an invite.</Card>
      ) : (
        <ul className="grid gap-2xl md:grid-cols-2">
          {rounds.map((r) => (
            <li key={r.id}>
              <Card className="flex h-full flex-col gap-2xl">
                <div>
                  <div className="flex items-center justify-between gap-lg">
                    <span className="font-medium">{r.company}</span>
                    <span className="rounded-full bg-primary-light px-lg py-xs text-xs font-medium text-primary-dark">
                      {inDays(daysUntil(r.scheduled_at))}
                    </span>
                  </div>
                  <p className="text-sm text-medium-gray">
                    {r.round_type_label} · {r.role}
                  </p>
                  <p className="text-sm text-medium-gray">{formatDateTime(r.scheduled_at)}</p>
                </div>
                <div className="mt-auto flex gap-lg">
                  <Button variant="primary" href={`/prep?new=${r.application}&round=${r.id}`}>
                    Prep plan
                  </Button>
                  <Button variant="secondary" onClick={() => openRoundForm({ round: r })}>
                    Edit
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default UpcomingRounds;
