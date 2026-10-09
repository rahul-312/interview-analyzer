import React from 'react';

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring that fills to the score, coloured green, amber or red. */
const ScoreRing: React.FC<{ score: number }> = ({ score }) => {
  const color = score >= 70 ? '#059669' : score >= 45 ? '#D97706' : '#DC2626';

  return (
    <svg viewBox="0 0 88 88" className="h-score-ring w-score-ring shrink-0" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="44" cy="44" r={RADIUS} fill="none" stroke="#E2E8F0" strokeWidth="8" />
      <circle
        cx="44"
        cy="44"
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="50" textAnchor="middle" className="fill-ink text-xl font-semibold">
        {score}
      </text>
    </svg>
  );
};

export default ScoreRing;
