'use client';

import React, { useState } from 'react';
import Button from '../ui/Button';
import { ErrorMessage } from '../ui/Feedback';
import { Field, Input, Select } from '../ui/FormControls';
import DebriefSection, { emptyQuestion } from './DebriefSection';
import { outcomeOptions, roundTypeOptions } from '@/config/options';
import { useApi } from '@/hooks/useApi';
import type { Debrief, InterviewRound, Outcome, RoundInput, RoundType } from '@/models/Interview';
import { applicationService } from '@/services/ApplicationService';
import { roundService } from '@/services/RoundService';
import { errorText } from '@/utils/errorText';
import { toLocalInput } from '@/utils/format';

interface RoundFormProps {
  applicationId?: number;
  round?: InterviewRound;
  withDebrief?: boolean;
  onSaved: (round: InterviewRound) => void;
  onCancel?: () => void;
}

const emptyDebrief: Debrief = {
  questions: [{ ...emptyQuestion }],
  went_well: '',
  went_badly: '',
  interviewer_cues: '',
  recruiter_feedback: '',
  overall_feeling: null,
};

const initialDebrief = (round?: InterviewRound): Debrief => {
  if (!round?.debrief) return structuredClone(emptyDebrief);
  const debrief = structuredClone(round.debrief);
  if (!debrief.questions.length) debrief.questions = [{ ...emptyQuestion }];
  return debrief;
};

/**
 * Logs or edits an interview round. The "This round is done" checkbox reveals the debrief.
 * Without `applicationId` or `round`, an application picker is shown.
 */
const RoundForm: React.FC<RoundFormProps> = ({ applicationId, round, withDebrief = false, onSaved, onCancel }) => {
  const needsPicker = !applicationId && !round;
  const { data: applications } = useApi(needsPicker ? 'applications' : null, () => applicationService.list());

  const [application, setApplication] = useState<number | ''>(round?.application ?? applicationId ?? '');
  const [roundType, setRoundType] = useState<RoundType>(round?.round_type ?? 'technical');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(round?.scheduled_at));
  const [interviewer, setInterviewer] = useState(round?.interviewer ?? '');
  const [outcome, setOutcome] = useState<Outcome>(round?.outcome ?? 'pending');
  const [done, setDone] = useState(withDebrief || Boolean(round?.debrief));
  const [debrief, setDebrief] = useState<Debrief>(() => initialDebrief(round));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    const input: RoundInput = {
      application,
      round_type: roundType,
      scheduled_at: new Date(scheduledAt).toISOString(),
      interviewer,
      outcome,
    };
    if (done) {
      input.debrief = {
        questions: debrief.questions.filter((q) => q.question.trim()),
        went_well: debrief.went_well,
        went_badly: debrief.went_badly,
        interviewer_cues: debrief.interviewer_cues,
        recruiter_feedback: debrief.recruiter_feedback,
        overall_feeling: debrief.overall_feeling,
      };
    }

    try {
      const saved = round ? await roundService.update(round.id, input) : await roundService.create(input);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4xl">
      {/* Application picker */}
      {needsPicker && (
        <Field id="application" label="Application">
          <Select
            id="application"
            required
            value={application}
            onChange={(e) => setApplication(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Choose an application…</option>
            {applications?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.company} · {a.role}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {/* Round details */}
      <div className="grid gap-4xl md:grid-cols-2">
        <Field id="round_type" label="Round type">
          <Select id="round_type" value={roundType} onChange={(e) => setRoundType(e.target.value as RoundType)}>
            {roundTypeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="scheduled_at" label="Date and time">
          <Input
            id="scheduled_at"
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Field>
        <Field id="interviewer" label="Interviewer">
          <Input id="interviewer" placeholder="Optional" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
        </Field>
        <Field id="outcome" label="Outcome">
          <Select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {outcomeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Debrief toggle */}
      <label className="flex items-center gap-lg rounded-lg bg-page-bg px-2xl py-xl text-sm font-medium">
        <input
          type="checkbox"
          className="h-4xl w-4xl accent-primary"
          checked={done}
          onChange={(e) => setDone(e.target.checked)}
        />
        This round is done: write a debrief
      </label>

      {done && <DebriefSection debrief={debrief} onChange={setDebrief} />}

      <ErrorMessage message={error} />

      {/* Actions */}
      <div className="flex justify-end gap-lg pt-sm">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : done ? 'Save and analyse' : round ? 'Save changes' : 'Log round'}
        </Button>
      </div>
    </form>
  );
};

export default RoundForm;
