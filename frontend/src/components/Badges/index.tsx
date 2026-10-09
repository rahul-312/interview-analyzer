import React from 'react';
import type { AppStatus } from '@/models/Application';
import type { Analysis, Outcome, Severity } from '@/models/Interview';

const base = 'inline-flex items-center whitespace-nowrap rounded-full px-lg py-xs text-xs font-medium';

const statusStyles: Record<AppStatus, string> = {
  applied: 'bg-smoke-white text-charcoal-gray',
  screening: 'bg-sky-light text-sky-dark',
  interview: 'bg-primary-light text-primary-dark',
  offer: 'bg-mint-cream text-deep-green',
  rejected: 'bg-rose-light text-rose-dark',
  withdrawn: 'bg-amber-light text-amber-dark',
};

export const StatusBadge: React.FC<{ status: AppStatus; label: string }> = ({ status, label }) => (
  <span className={`${base} ${statusStyles[status]}`}>{label}</span>
);

const outcomeStyles: Record<Outcome, string> = {
  pending: 'bg-smoke-white text-dark-gray',
  passed: 'bg-mint-cream text-deep-green',
  failed: 'bg-rose-light text-rose-dark',
};

export const OutcomeBadge: React.FC<{ outcome: Outcome }> = ({ outcome }) => (
  <span className={`${base} ${outcomeStyles[outcome]}`}>{outcome[0].toUpperCase() + outcome.slice(1)}</span>
);

const severityStyles: Record<Severity, string> = {
  low: 'bg-amber-light text-amber-dark',
  medium: 'bg-orange-light text-orange-dark',
  high: 'bg-rose-light text-rose-dark',
};

export const SeverityBadge: React.FC<{ severity: Severity }> = ({ severity }) => (
  <span className={`${base} ${severityStyles[severity]}`}>{severity}</span>
);

/** Shows where an analysis is: queued, analysing, failed or its score. */
export const AnalysisBadge: React.FC<{ analysis: Analysis | null }> = ({ analysis }) => {
  if (!analysis) return null;
  if (analysis.status === 'pending') return <span className={`${base} bg-smoke-white text-dark-gray`}>Queued</span>;
  if (analysis.status === 'running')
    return <span className={`${base} animate-pulse bg-primary-light text-primary-dark`}>Analysing…</span>;
  if (analysis.status === 'failed') return <span className={`${base} bg-rose-light text-rose-dark`}>Analysis failed</span>;

  const score = analysis.score ?? 0;
  const tone =
    score >= 70 ? 'bg-mint-cream text-deep-green' : score >= 45 ? 'bg-amber-light text-amber-dark' : 'bg-rose-light text-rose-dark';
  return <span className={`${base} ${tone}`}>Score {score}</span>;
};
