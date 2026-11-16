import React from 'react';
import { SeverityBadge } from '../Badges';
import ScoreRing from '../Interviews/RoundAnalysis/ScoreRing';
import Card from '../ui/Card';

/** A made-up round's analysis, drawn with the same parts as the real one. */
const AnalysisPreview: React.FC = () => {
  return (
    <figure className="flex flex-col gap-lg">
      <Card className="flex flex-col gap-4xl">
        <div className="flex items-center gap-6xl">
          <ScoreRing score={58} />
          <div>
            <p className="text-xs font-semibold tracking-wide text-medium-gray uppercase">System design round</p>
            <p className="mt-sm text-sm text-charcoal-gray">
              Clear on the data model, but the scaling questions went unanswered.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-lg border-t border-light-gray pt-4xl">
          <div className="flex items-center gap-lg">
            <span className="font-medium">Caching strategy</span>
            <SeverityBadge severity="high" />
          </div>
          <p className="text-sm text-dark-gray">You named a cache, but couldn&apos;t say how entries get invalidated.</p>
          <p className="rounded-lg bg-primary-light px-2xl py-lg text-sm text-primary-dark">
            <span className="font-medium">Fix: </span>
            Practise walking through write-through and TTL trade-offs out loud.
          </p>
        </div>

        <div className="border-t border-light-gray pt-4xl">
          <p className="mb-md text-xs font-semibold tracking-wide text-medium-gray uppercase">Prep plan · Day 1</p>
          <p className="rounded-lg border border-light-gray p-2xl text-sm font-medium">
            Design a cache for a news feed <span className="font-normal text-medium-gray">· 45 min</span>
          </p>
        </div>
      </Card>
      <figcaption className="text-center text-xs text-medium-gray">An example analysis</figcaption>
    </figure>
  );
};

export default AnalysisPreview;
