'use client';

import React from 'react';
import type { PrepTask } from '@/models/PrepPlan';
import { formatDate } from '@/utils/format';

interface TaskListProps {
  tasks: PrepTask[];
  onToggle: (task: PrepTask) => void;
}

/** Tasks grouped by day, each with a checkbox. */
const TaskList: React.FC<TaskListProps> = ({ tasks, onToggle }) => {
  const byDay = tasks.reduce<Record<string, PrepTask[]>>((acc, task) => {
    (acc[task.date] ??= []).push(task);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4xl">
      {Object.entries(byDay).map(([date, dayTasks], i) => (
        <div key={date}>
          <p className="mb-md text-xs font-semibold tracking-wide text-medium-gray uppercase">
            Day {i + 1} · {formatDate(date)}
          </p>
          <ul className="flex flex-col gap-lg">
            {dayTasks.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer gap-2xl rounded-lg border border-light-gray p-2xl hover:bg-page-bg">
                  <input
                    type="checkbox"
                    className="mt-xs h-4xl w-4xl shrink-0 accent-emerald-green"
                    checked={t.done}
                    onChange={() => onToggle(t)}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${t.done ? 'text-light-silver line-through' : ''}`}>
                      {t.title} <span className="font-normal text-light-silver">· {t.minutes} min</span>
                    </span>
                    {t.detail && <span className="mt-xs block text-sm text-medium-gray">{t.detail}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default TaskList;
