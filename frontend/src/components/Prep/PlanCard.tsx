'use client';

import React, { useState } from 'react';
import TaskList from './TaskList';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage, Working } from '../ui/Feedback';
import { useUsage } from '@/hooks/useUsage';
import type { PrepPlan, PrepTask } from '@/models/PrepPlan';
import { prepPlanService } from '@/services/PrepPlanService';
import { errorText } from '@/utils/errorText';
import { daysUntil, formatDate } from '@/utils/format';

interface PlanCardProps {
  plan: PrepPlan;
  onChange: () => void;
}

const countdownLabel = (days: number) => {
  if (days < 0) return 'Interview passed';
  if (days === 0) return 'Interview today';
  return `${days} day${days === 1 ? '' : 's'} to go`;
};

const countdownStyle = (days: number) => {
  if (days < 0) return 'bg-smoke-white text-medium-gray';
  if (days <= 2) return 'bg-rose-light text-rose-dark';
  return 'bg-primary-light text-primary-dark';
};

/** A prep plan: summary, countdown, progress bar, tasks by day, Regenerate and Delete. */
const PlanCard: React.FC<PlanCardProps> = ({ plan, onChange }) => {
  const [tasks, setTasks] = useState<PrepTask[]>(plan.tasks);
  const [prevTasks, setPrevTasks] = useState(plan.tasks);
  const [error, setError] = useState('');
  const { usage, reloadUsage } = useUsage();
  const outOfPlans = usage?.prep_plans.remaining === 0;

  // Take the server's tasks when the plan is reloaded
  if (plan.tasks !== prevTasks) {
    setPrevTasks(plan.tasks);
    setTasks(plan.tasks);
  }

  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const days = daysUntil(plan.interview_date);
  const generating = plan.status === 'pending' || plan.status === 'running';

  const handleToggle = async (task: PrepTask) => {
    setError('');
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      await prepPlanService.setTaskDone(task.id, !task.done);
    } catch (err) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
      setError(errorText(err));
    }
  };

  const handleRegenerate = async () => {
    if (doneCount && !confirm('Regenerating replaces all tasks, including ticked ones. Continue?')) return;
    try {
      await prepPlanService.regenerate(plan.id);
    } catch (err) {
      setError(errorText(err));
    }
    // Reload either way: a 409/429 means the plan or usage changed elsewhere
    onChange();
    reloadUsage();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this prep plan?')) return;
    try {
      await prepPlanService.remove(plan.id);
      onChange();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card className="flex flex-col gap-4xl">
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-2xl">
        <div>
          <h2 className="text-lg font-semibold">{plan.company}</h2>
          <p className="text-sm text-medium-gray">
            {plan.role}
            {plan.target_round_label && ` · ${plan.target_round_label}`} · {formatDate(plan.interview_date)}
          </p>
        </div>
        <span className={`rounded-full px-xl py-sm text-xs font-medium ${countdownStyle(days)}`}>{countdownLabel(days)}</span>
      </div>

      {generating ? (
        <Working text="Building your plan…" />
      ) : plan.status === 'failed' ? (
        <div className="flex flex-col gap-lg">
          <ErrorMessage message={`Plan generation failed: ${plan.error}`} />
          {plan.refunded && (
            <p className="rounded-lg bg-pale-mint px-2xl py-lg text-sm text-deep-green">
              This one didn&apos;t count towards your limit.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-charcoal-gray">{plan.summary}</p>
          {plan.source === 'rules' && (
            <p className="text-xs text-amber">Built by the rule-based planner. Add an API key on the server for an AI-built plan.</p>
          )}

          {/* Progress */}
          <div>
            <div className="mb-sm flex justify-between text-xs text-medium-gray">
              <span>
                {doneCount} of {tasks.length} tasks done
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-lg overflow-hidden rounded-full bg-smoke-white">
              <div className="h-full rounded-full bg-emerald-green transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <TaskList tasks={tasks} onToggle={handleToggle} />
        </>
      )}

      <ErrorMessage message={error} />

      {/* Actions */}
      <div className="flex justify-end gap-lg border-t border-smoke-white pt-2xl">
        <Button
          variant="secondary"
          onClick={handleRegenerate}
          disabled={generating || outOfPlans}
          title={outOfPlans ? 'No prep plans left in the last 24 hours on the free plan' : undefined}
        >
          Regenerate
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
};

export default PlanCard;
