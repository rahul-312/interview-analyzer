'use client';

import React, { useId } from 'react';
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
  color,
  height = 240,
  maxY,
}) => {
  const gradientId = `bar-${useId().replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-from)" />
              <stop offset="100%" stopColor="var(--color-brand-to)" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-light-gray)" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-medium-gray)' }} interval={0} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--color-medium-gray)' }}
            domain={[0, maxY ?? 'auto']}
            unit={unit}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-primary-light)' }}
            formatter={(value) => [`${value}${unit}`, name]}
            contentStyle={{ borderRadius: 8, borderColor: 'var(--color-light-gray)', fontSize: 13 }}
          />
          <Bar dataKey={yKey} name={name} fill={color ?? `url(#${gradientId})`} radius={[6, 6, 0, 0]} maxBarSize={56} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BarChart;
