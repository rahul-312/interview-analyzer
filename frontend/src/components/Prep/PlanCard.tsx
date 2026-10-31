'use client';

import React, { useRef, useState } from 'react';
import TaskList from './TaskList';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage, JobFailed, Working } from '../ui/Feedback';
import { useUsage } from '@/hooks/useUsage';
import type { PrepPlan, PrepTask } from '@/models/PrepPlan';
import { ApiError } from '@/services/ApiClient';
import { prepPlanService } from '@/services/PrepPlanService';
import { errorText } from '@/utils/errorText';
import { daysUntil, formatDate, planLabel } from '@/utils/format';

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
  // 'request': the regenerate call is running (it can take as long as the generation without a task queue).
  // 'reload': it started; keep the spinner until the reloaded plan arrives, so the old one doesn't flash.
  const [regenerating, setRegenerating] = useState<'request' | 'reload' | null>(null);
  const [prevPlan, setPrevPlan] = useState(plan);
  const { usage, reloadUsage } = useUsage();
  const outOfPlans = usage?.prep_plans.remaining === 0;
  const outOfPlansTitle = outOfPlans ? `No prep plans left in the last 24 hours on the ${planLabel(usage?.plan)} plan` : undefined;

  // Take the server's tasks when the plan is reloaded
  if (plan.tasks !== prevTasks) {
    setPrevTasks(plan.tasks);
    setTasks(plan.tasks);
  }
  if (plan !== prevPlan) {
    setPrevPlan(plan);
    if (regenerating === 'reload') setRegenerating(null);
  }

  const doneCount = tasks.filter((t) => t.done).length;
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;
  const days = daysUntil(plan.interview_date);
  const failed = plan.status === 'failed';
  const generating = regenerating !== null || plan.status === 'pending' || plan.status === 'running';

  // Tasks with a save in flight. A second click (e.g. a double-click) waits, so saves can't land out of order.
  const saving = useRef(new Set<number>());

  const handleToggle = async (task: PrepTask) => {
    if (saving.current.has(task.id)) return;
    saving.current.add(task.id);
    setError('');
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      await prepPlanService.setTaskDone(task.id, !task.done);
    } catch (err) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
      setError(errorText(err));
    } finally {
      saving.current.delete(task.id);
    }
  };

  const handleRegenerate = async () => {
    // A failed plan's ticked tasks aren't on screen, so there's nothing to warn about
    if (!failed && doneCount && !confirm('Regenerating replaces all tasks, including ticked ones. Continue?')) return;
    setError('');
    setRegenerating('request');
    let started = true;
    try {
      await prepPlanService.regenerate(plan.id);
    } catch (err) {
      // 409: it's already generating, which the reload below shows
      if (!(err instanceof ApiError && err.status === 409)) {
        setError(errorText(err));
        started = false;
      }
    }
    setRegenerating(started ? 'reload' : null);
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
      ) : failed ? (
        <JobFailed
          title="We couldn't build this plan."
          reason={plan.error}
          refundedWhat={plan.refunded && 'one of your prep plans'}
          onRetry={handleRegenerate}
          retryDisabled={outOfPlans}
          retryTitle={outOfPlansTitle}
        />
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
        {/* A failed plan has its own Try again */}
        {(!failed || regenerating) && (
          <Button
            variant="secondary"
            onClick={handleRegenerate}
            loading={regenerating !== null}
            disabled={generating || outOfPlans}
            title={outOfPlansTitle}
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </Button>
        )}
        <Button variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
};

export default PlanCard;
