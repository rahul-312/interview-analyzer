'use client';

import React from 'react';
import BarChart from '../Charts/BarChart';
import Card from '../ui/Card';
import type { Funnel } from '@/models/Insights';

/** How many applications reached each stage, plus a by-source table. */
const Pipeline: React.FC<{ funnel: Funnel }> = ({ funnel }) => {
  const conversions = funnel.stages
    .filter((s) => s.conversion !== null)
    .map((s) => `${s.label}: ${s.conversion}%`)
    .join(' · ');

  return (
    <section className="flex flex-col gap-2xl">
      <h2 className="text-lg font-semibold">Pipeline</h2>

      {funnel.total === 0 ? (
        <Card className="text-sm text-medium-gray">Add applications to see your pipeline.</Card>
      ) : (
        <div className="grid gap-2xl lg:grid-cols-2">
          {/* Stage chart */}
          <Card className="flex flex-col gap-lg">
            <BarChart data={funnel.stages} xKey="label" yKey="count" name="Applications" />
            <p className="text-xs text-medium-gray">{conversions} conversion from the previous stage</p>
          </Card>

          {/* By source */}
          <Card className="overflow-x-auto">
            <h3 className="mb-lg text-sm font-medium text-charcoal-gray">By source</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-medium-gray">
                <tr>
                  <th className="py-lg font-medium">Source</th>
                  <th className="py-lg text-right font-medium">Applied</th>
                  <th className="py-lg text-right font-medium">Interviews</th>
                  <th className="py-lg text-right font-medium">Offers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-smoke-white tabular-nums">
                {funnel.by_source.map((s) => (
                  <tr key={s.source}>
                    <td className="py-lg">{s.label}</td>
                    <td className="py-lg text-right">{s.total}</td>
                    <td className="py-lg text-right">{s.interviews}</td>
                    <td className="py-lg text-right">{s.offers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </section>
  );
};

export default Pipeline;
