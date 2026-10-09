'use client';

import React from 'react';
import Button from '../ui/Button';

interface RatingProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}

const selectedStyle = (n: number) =>
  n <= 2
    ? 'border-crimson-red bg-crimson-red text-white'
    : n === 3
      ? 'border-amber bg-amber text-white'
      : 'border-emerald-green bg-emerald-green text-white';

/** A 1-5 picker. Clicking the selected value clears it. */
const Rating: React.FC<RatingProps> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center gap-sm" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Button
          key={n}
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(value === n ? null : n)}
          className={`h-12xl w-12xl rounded-lg border text-sm font-medium transition-colors ${
            value === n ? selectedStyle(n) : 'border-input-border bg-white text-dark-gray hover:bg-page-bg'
          }`}
        >
          {n}
        </Button>
      ))}
    </div>
  );
};

export default Rating;
