import React from 'react';
import { CircleCheck, CircleX, FileCheck2, FileText, TrendingUp, UsersRound, type LucideIcon } from 'lucide-react';
import type { Application, AppStatus } from '@/models/Application';
import { today } from '@/utils/format';

interface StatCardsProps {
  applications: Application[];
  counts: Partial<Record<AppStatus, number>>;
}

interface Share {
  label: string;
  status: AppStatus;
  icon: LucideIcon;
  /** Card tint, and the icon tile, bar and percentage colours. */
  tint: string;
  tile: string;
  bar: string;
  text: string;
}

const shares: Share[] = [
  { label: 'Applied', status: 'applied', icon: CircleCheck, tint: 'from-primary-light/70', tile: 'bg-primary-light text-primary', bar: 'bg-primary', text: 'text-primary' },
  { label: 'Interviewing', status: 'interview', icon: UsersRound, tint: 'from-amber-light/80', tile: 'bg-amber-light text-amber', bar: 'bg-amber', text: 'text-amber' },
  { label: 'Offers', status: 'offer', icon: FileCheck2, tint: 'from-sky-light/80', tile: 'bg-sky-light text-sky', bar: 'bg-sky', text: 'text-sky' },
  { label: 'Rejected', status: 'rejected', icon: CircleX, tint: 'from-rose-light/80', tile: 'bg-rose-light text-crimson-red', bar: 'bg-crimson-red', text: 'text-crimson-red' },
];

const cardClasses = 'glass flex flex-col justify-between gap-4xl rounded-2xl bg-linear-to-br to-transparent to-70% p-6xl';

const Figure: React.FC<{ icon: LucideIcon; tile: string; value: number; label: string }> = ({ icon: Icon, tile, value, label }) => (
  <div className="flex items-start gap-2xl">
    <span className={`flex size-16xl shrink-0 items-center justify-center rounded-xl ${tile}`}>
      <Icon size={20} strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <p className="font-serif text-stat font-medium tabular-nums">{value}</p>
      <p className="truncate text-sm text-medium-gray">{label}</p>
    </div>
  </div>
);

/** Headline numbers: the total, how many were added this month, and each stage's share of the total. */
const StatCards: React.FC<StatCardsProps> = ({ applications, counts }) => {
  const total = applications.length;
  const month = today().slice(0, 7);
  const thisMonth = applications.filter((a) => a.date_applied.startsWith(month)).length;

  return (
    <div className="grid grid-cols-2 gap-2xl sm:grid-cols-3 xl:grid-cols-5">
      <div className={`${cardClasses} col-span-2 from-white/60 sm:col-span-1`}>
        <Figure icon={FileText} tile="bg-white/80 text-primary" value={total} label="Total applications" />
        <p className="flex items-center gap-sm text-xs text-medium-gray">
          <TrendingUp size={14} className="text-primary" />+{thisMonth} this month
        </p>
      </div>

      {shares.map((share) => {
        const count = counts[share.status] ?? 0;
        const percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <div key={share.status} className={`${cardClasses} ${share.tint}`}>
            <Figure icon={share.icon} tile={share.tile} value={count} label={share.label} />
            <div className="flex items-center gap-2xl">
              <div className="h-md flex-1 overflow-hidden rounded-full bg-white/70">
                <div className={`h-full rounded-full ${share.bar}`} style={{ width: `${percent}%` }} />
              </div>
              <span className={`text-xs font-medium tabular-nums ${share.text}`}>{percent}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatCards;
