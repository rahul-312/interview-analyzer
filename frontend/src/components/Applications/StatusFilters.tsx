'use client';

import React from 'react';
import Button from '../ui/Button';
import { statusOptions } from '@/config/options';
import type { AppStatus } from '@/models/Application';

interface StatusFiltersProps {
  value: AppStatus | '';
  counts: Partial<Record<AppStatus, number>>;
  total: number;
  onChange: (status: AppStatus | '') => void;
}

/** Status chips with counts. */
const StatusFilters: React.FC<StatusFiltersProps> = ({ value, counts, total, onChange }) => {
  const chips = [{ value: '' as const, label: 'All' }, ...statusOptions];

  return (
    <div className="flex flex-wrap gap-lg">
      {chips.map((chip) => {
        const active = value === chip.value;
        const count = chip.value ? counts[chip.value] ?? 0 : total;
        return (
          <Button
            key={chip.value || 'all'}
            onClick={() => onChange(chip.value)}
            aria-pressed={active}
            className={`flex items-center gap-lg rounded-full px-3xl py-md text-sm font-medium transition-colors ${
              active
                ? 'border border-transparent bg-brand text-white shadow-card'
                : 'glass text-charcoal-gray hover:bg-white/80'
            }`}
          >
            {chip.label}
            <span
              className={`min-w-5xl rounded-full px-md text-xs tabular-nums ${
                active ? 'bg-white/15 text-white' : 'bg-white/80 text-medium-gray'
              }`}
            >
              {count}
            </span>
          </Button>
        );
      })}
    </div>
  );
};

export default StatusFilters;
