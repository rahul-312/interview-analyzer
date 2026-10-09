'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import NewPlanForm from './NewPlanForm';
import PlanCard from './PlanCard';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage, Loading } from '../ui/Feedback';
import PageHeader from '../ui/PageHeader';
import { useDialogs } from '@/context/DialogsContext';
import { useApi } from '@/hooks/useApi';
import { useRefreshUsageWhenDone } from '@/hooks/useUsage';
import type { PrepPlan } from '@/models/PrepPlan';
import { prepPlanService } from '@/services/PrepPlanService';

const isGenerating = (plans: PrepPlan[]) => plans.some((p) => p.status === 'pending' || p.status === 'running');

const queryNumber = (value: string | string[] | undefined): number | '' =>
  typeof value === 'string' && value ? Number(value) : '';

const Prep = () => {
  const router = useRouter();
  const { bump } = useDialogs();
  const newParam = queryNumber(router.query.new);
  const roundParam = queryNumber(router.query.round);

  // ?new=<application id> opens the form straight away
  const [formOpen, setFormOpen] = useState(false);
  const [prevNewParam, setPrevNewParam] = useState<number | ''>('');
  if (newParam !== prevNewParam) {
    setPrevNewParam(newParam);
    if (newParam) setFormOpen(true);
  }

  // Poll while a plan is being generated
  const { data: plans, error, loading, reload } = useApi('prep-plans', () => prepPlanService.list(), isGenerating);
  // A refunded (failed) plan changes the count, so refresh it when generation finishes
  useRefreshUsageWhenDone(isGenerating(plans ?? []));

  const closeForm = () => {
    setFormOpen(false);
    if (newParam) router.replace('/prep', undefined, { shallow: true });
  };

  return (
    <div className="flex flex-col gap-8xl">
      <PageHeader
        title="Prep"
        subtitle="Day-by-day plans for your upcoming interviews, built around your weak spots."
        actions={
          !formOpen && (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              + New prep plan
            </Button>
          )
        }
      />

      {formOpen && (
        <NewPlanForm
          key={`${newParam}-${roundParam}`}
          initialApplication={newParam}
          initialRound={roundParam}
          onCancel={closeForm}
          onCreated={() => {
            closeForm();
            reload();
            bump();
          }}
        />
      )}

      <ErrorMessage message={error} />

      {loading && !plans ? (
        <Loading />
      ) : !plans?.length ? (
        !formOpen && (
          <Card className="py-16xl text-center text-sm text-medium-gray">
            No prep plans yet. Make one for an upcoming interview.
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-4xl">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onChange={reload} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Prep;
