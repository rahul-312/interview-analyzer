import React from 'react';
import type { Interval } from '@/models/Billing';

const options: { value: Interval; label: string }[] = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

/** Monthly / yearly switch for paid prices. */
const IntervalToggle: React.FC<{ value: Interval; onChange: (value: Interval) => void }> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="Billing period" className="inline-flex glass rounded-full p-sm">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={`cursor-pointer rounded-full px-4xl py-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-border ${
          value === option.value ? 'bg-primary text-white shadow-sm' : 'text-dark-gray hover:text-ink'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export default IntervalToggle;
