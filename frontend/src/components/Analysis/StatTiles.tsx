import React from 'react';
import Card from '../ui/Card';
import type { Insights } from '@/models/Insights';

interface StatTile {
  label: string;
  value: number;
  hint?: string;
}

/** Four headline numbers: applications, reached interviews, offers, rounds analysed. */
const StatTiles: React.FC<{ insights: Insights }> = ({ insights }) => {
  const { funnel } = insights;
  const stageCount = (stage: string) => funnel.stages.find((s) => s.stage === stage)?.count ?? 0;
  const interviews = stageCount('interview');

  const tiles: StatTile[] = [
    { label: 'Applications', value: funnel.total },
    {
      label: 'Reached interviews',
      value: interviews,
      hint: funnel.total ? `${Math.round((interviews / funnel.total) * 100)}% of applications` : undefined,
    },
    { label: 'Offers', value: stageCount('offer') },
    {
      label: 'Rounds analysed',
      value: insights.analysed_rounds,
      hint: insights.ai_enabled ? 'AI analysis on' : 'Rule-based analysis',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2xl lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <p className="text-sm text-medium-gray">{tile.label}</p>
          <p className="mt-sm text-stat font-semibold tabular-nums">{tile.value}</p>
          {tile.hint && <p className="mt-sm text-xs text-light-silver">{tile.hint}</p>}
        </Card>
      ))}
    </div>
  );
};

export default StatTiles;
