'use client';

import React from 'react';
import Link from 'next/link';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { useDialogs } from '@/context/DialogsContext';
import type { WeakSpot } from '@/models/Insights';

/** Weak spots ranked worst first, each with a fix and chips linking to the rounds it came from. */
const WeakSpots: React.FC<{ weakSpots: WeakSpot[] }> = ({ weakSpots }) => {
  const { openRoundForm } = useDialogs();

  return (
    <section className="flex flex-col gap-2xl">
      {/* Heading */}
      <div className="flex flex-wrap items-center justify-between gap-lg">
        <h2 className="text-lg font-semibold">Your weak spots</h2>
        {weakSpots.length > 0 && (
          <Button variant="primary" href="/prep">
            Turn these into a prep plan
          </Button>
        )}
      </div>

      {weakSpots.length === 0 ? (
        <Card className="text-sm text-medium-gray">
          <p>No weak spots yet. Debrief a past round and they&apos;ll show up here, ranked worst first.</p>
          <Button variant="secondary" className="mt-2xl" onClick={() => openRoundForm({ withDebrief: true })}>
            Write a debrief
          </Button>
        </Card>
      ) : (
        <ol className="flex flex-col gap-2xl">
          {weakSpots.map((w, i) => (
            <li key={w.topic}>
              <Card className="flex flex-col gap-lg">
                <div className="flex flex-wrap items-center gap-lg">
                  <span className="flex h-8xl w-8xl items-center justify-center rounded-full bg-smoke-white text-xs font-semibold text-dark-gray">
                    {i + 1}
                  </span>
                  <span className="font-medium capitalize">{w.topic}</span>
                  <span className="text-xs text-medium-gray">
                    {w.count} time{w.count === 1 ? '' : 's'}
                    {w.high_count > 0 && ` · ${w.high_count} high severity`}
                  </span>
                </div>
                {w.latest_advice && (
                  <p className="rounded-lg bg-primary-light px-2xl py-lg text-sm text-primary-dark">
                    <span className="font-medium">Fix: </span>
                    {w.latest_advice}
                  </p>
                )}
                <div className="flex flex-wrap gap-md">
                  {w.rounds.map((r) => (
                    <Link
                      key={r.id}
                      href={`/interviews/${r.id}`}
                      className="rounded-full border border-light-gray px-xl py-xs text-xs text-dark-gray hover:border-primary-border hover:text-primary-dark"
                    >
                      {r.company} · {r.round_type}
                    </Link>
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default WeakSpots;
