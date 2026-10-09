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
            className={`rounded-full border px-2xl py-sm text-sm transition-colors ${
              active
                ? 'border-primary bg-primary text-white'
                : 'border-input-border bg-white text-dark-gray hover:bg-page-bg'
            }`}
          >
            {chip.label} <span className={active ? 'text-primary-light' : 'text-light-silver'}>{count}</span>
          </Button>
        );
      })}
    </div>
  );
};

export default StatusFilters;
