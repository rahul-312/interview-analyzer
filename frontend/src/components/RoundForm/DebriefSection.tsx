'use client';

import React from 'react';
import Button from '../ui/Button';
import { Field, Label, TextArea } from '../ui/FormControls';
import QuestionCard from './QuestionCard';
import Rating from './Rating';
import type { Debrief, DebriefQuestion } from '@/models/Interview';

export const emptyQuestion: DebriefQuestion = { question: '', answer: '', topic: '', confidence: null };

interface DebriefSectionProps {
  debrief: Debrief;
  onChange: (debrief: Debrief) => void;
}

type TextKey = 'went_well' | 'went_badly' | 'interviewer_cues' | 'recruiter_feedback';

const textFields: { key: TextKey; label: string; rows: number; placeholder?: string }[] = [
  { key: 'went_well', label: 'What went well', rows: 3 },
  { key: 'went_badly', label: 'What went badly', rows: 3 },
  { key: 'interviewer_cues', label: 'Interviewer cues', rows: 2, placeholder: 'Follow-ups, hints, reactions' },
  { key: 'recruiter_feedback', label: 'Recruiter feedback', rows: 2 },
];

/** The debrief: a list of questions, then notes on how it went. */
const DebriefSection: React.FC<DebriefSectionProps> = ({ debrief, onChange }) => {
  const set = <K extends keyof Debrief>(key: K, value: Debrief[K]) => onChange({ ...debrief, [key]: value });

  const updateQuestion = (index: number, patch: Partial<DebriefQuestion>) =>
    set(
      'questions',
      debrief.questions.map((q, i) => (i === index ? { ...q, ...patch } : q))
    );

  return (
    <div className="flex flex-col gap-6xl border-l-2 border-primary-light pl-4xl">
      {/* Questions */}
      <div className="flex flex-col gap-2xl">
        <h3 className="text-sm font-semibold text-charcoal-gray">Questions you were asked</h3>
        {debrief.questions.map((q, i) => (
          <QuestionCard
            key={i}
            index={i}
            question={q}
            onChange={(patch) => updateQuestion(i, patch)}
            onRemove={
              debrief.questions.length > 1
                ? () => set('questions', debrief.questions.filter((_, j) => j !== i))
                : undefined
            }
          />
        ))}
        <Button variant="link" className="self-start" onClick={() => set('questions', [...debrief.questions, { ...emptyQuestion }])}>
          + Add question
        </Button>
      </div>

      {/* How it went */}
      <div className="grid gap-4xl md:grid-cols-2">
        {textFields.map((f) => (
          <Field key={f.key} id={f.key} label={f.label}>
            <TextArea
              id={f.key}
              rows={f.rows}
              placeholder={f.placeholder}
              value={debrief[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </Field>
        ))}
      </div>

      <div>
        <Label>Overall feeling</Label>
        <Rating label="Overall feeling" value={debrief.overall_feeling} onChange={(n) => set('overall_feeling', n)} />
      </div>
    </div>
  );
};

export default DebriefSection;
