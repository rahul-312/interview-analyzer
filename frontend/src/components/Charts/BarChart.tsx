'use client';

import React from 'react';
import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface BarChartProps {
  data: object[];
  xKey: string;
  yKey: string;
  name: string;
  unit?: string;
  color?: string;
  height?: number;
  maxY?: number;
}

/** One reusable single-series bar chart with a hover tooltip and rounded bar tops. */
const BarChart: React.FC<BarChartProps> = ({
  data,
  xKey,
  yKey,
  name,
  unit = '',
  color = '#4F46E5',
  height = 240,
  maxY,
}) => {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748B' }} interval={0} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#64748B' }}
            domain={[0, maxY ?? 'auto']}
            unit={unit}
          />
          <Tooltip
            cursor={{ fill: '#EEF2FF' }}
            formatter={(value) => [`${value}${unit}`, name]}
            contentStyle={{ borderRadius: 8, borderColor: '#E2E8F0', fontSize: 13 }}
          />
          <Bar dataKey={yKey} name={name} fill={color} radius={[6, 6, 0, 0]} maxBarSize={56} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BarChart;
