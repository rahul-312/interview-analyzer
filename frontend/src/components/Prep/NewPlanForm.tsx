'use client';

import React, { useState } from 'react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ErrorMessage } from '../ui/Feedback';
import { Field, Input, Select } from '../ui/FormControls';
import { useApi } from '@/hooks/useApi';
import { applicationService } from '@/services/ApplicationService';
import { prepPlanService } from '@/services/PrepPlanService';
import { roundService } from '@/services/RoundService';
import { errorText } from '@/utils/errorText';
import { formatDateTime, isPast, today } from '@/utils/format';

interface NewPlanFormProps {
  initialApplication: number | '';
  initialRound: number | '';
  onCreated: () => void;
  onCancel: () => void;
}

/** Pick the application, then an upcoming round, or a date if none is scheduled. */
const NewPlanForm: React.FC<NewPlanFormProps> = ({ initialApplication, initialRound, onCreated, onCancel }) => {
  const [application, setApplication] = useState<number | ''>(initialApplication);
  const [round, setRound] = useState<number | ''>(initialRound);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: applications } = useApi('applications', () => applicationService.list());
  const { data: rounds } = useApi(application ? `rounds-${application}` : null, () => roundService.list(application));
  const upcoming = (rounds ?? []).filter((r) => !isPast(r.scheduled_at));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await prepPlanService.create({
        application,
        target_round: round || null,
        ...(round ? {} : { interview_date: date }),
      });
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4xl">
        <h2 className="text-lg font-semibold">New prep plan</h2>

        <div className="grid gap-4xl md:grid-cols-2">
          <Field id="plan_application" label="Application">
            <Select
              id="plan_application"
              required
              value={application}
              onChange={(e) => {
                setApplication(e.target.value ? Number(e.target.value) : '');
                setRound('');
              }}
            >
              <option value="">Choose…</option>
              {applications?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company} · {a.role}
                </option>
              ))}
            </Select>
          </Field>

          {/* Upcoming round, if any are scheduled */}
          {application !== '' && upcoming.length > 0 && (
            <Field id="plan_round" label="Upcoming round">
              <Select id="plan_round" value={round} onChange={(e) => setRound(e.target.value ? Number(e.target.value) : '')}>
                <option value="">None: I&apos;ll enter a date</option>
                {upcoming.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.round_type_label} · {formatDateTime(r.scheduled_at)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/* Otherwise, a date */}
          {application !== '' && !round && (
            <Field id="plan_date" label="Interview date">
              <Input id="plan_date" type="date" min={today()} required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          )}
        </div>

        <p className="text-xs text-medium-gray">
          The plan puts your recurring weak spots first, then the basics for the round type. Up to 14 days.
        </p>
        <ErrorMessage message={error} />

        <div className="flex justify-end gap-lg">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || application === ''}>
            {busy ? 'Creating…' : 'Create plan'}
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default NewPlanForm;
