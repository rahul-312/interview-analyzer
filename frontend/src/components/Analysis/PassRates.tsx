'use client';

import React from 'react';
import BarChart from '../Charts/BarChart';
import Card from '../ui/Card';
import type { Insights } from '@/models/Insights';

/** Pass rate by round type: a chart, a table, and where you drop out most. */
const PassRates: React.FC<{ outcomes: Insights['round_outcomes'] }> = ({ outcomes }) => {
  const decided = outcomes.by_type.filter((r) => r.pass_rate !== null);

  return (
    <section className="flex flex-col gap-2xl">
      <h2 className="text-lg font-semibold">Pass rate by round type</h2>

      {outcomes.by_type.length === 0 ? (
        <Card className="text-sm text-medium-gray">Log rounds and set their outcome to see pass rates.</Card>
      ) : (
        <Card className="flex flex-col gap-4xl">
          {outcomes.weakest && (
            <p className="text-sm">
              You drop out most at <span className="font-semibold">{outcomes.weakest}</span> rounds.
            </p>
          )}
          {decided.length > 0 && <BarChart data={decided} xKey="label" yKey="pass_rate" name="Pass rate" unit="%" maxY={100} />}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-medium-gray">
                <tr>
                  <th className="py-lg font-medium">Round type</th>
                  <th className="py-lg text-right font-medium">Passed</th>
                  <th className="py-lg text-right font-medium">Failed</th>
                  <th className="py-lg text-right font-medium">Pending</th>
                  <th className="py-lg text-right font-medium">Pass rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-smoke-white tabular-nums">
                {outcomes.by_type.map((r) => (
                  <tr key={r.round_type}>
                    <td className="py-lg">{r.label}</td>
                    <td className="py-lg text-right">{r.passed}</td>
                    <td className="py-lg text-right">{r.failed}</td>
                    <td className="py-lg text-right">{r.pending}</td>
                    <td className="py-lg text-right">{r.pass_rate === null ? '–' : `${r.pass_rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
};

export default PassRates;
