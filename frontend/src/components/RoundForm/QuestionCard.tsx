'use client';

import React from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import { Input, TextArea } from '../ui/FormControls';
import Rating from './Rating';
import type { DebriefQuestion } from '@/models/Interview';

interface QuestionCardProps {
  index: number;
  question: DebriefQuestion;
  onChange: (patch: Partial<DebriefQuestion>) => void;
  onRemove?: () => void;
}

/** One debrief question: what was asked, roughly what you said, its topic and your confidence. */
const QuestionCard: React.FC<QuestionCardProps> = ({ index, question, onChange, onRemove }) => {
  return (
    <div className="flex flex-col gap-lg rounded-lg border border-light-gray p-2xl">
      <div className="flex items-start gap-lg">
        <Input
          placeholder={`Question ${index + 1}`}
          value={question.question}
          onChange={(e) => onChange({ question: e.target.value })}
        />
        {onRemove && (
          <Button variant="secondary" aria-label="Remove question" className="px-xl" onClick={onRemove}>
            <X size={16} />
          </Button>
        )}
      </div>
      <TextArea
        rows={2}
        placeholder="What you answered (roughly)"
        value={question.answer}
        onChange={(e) => onChange({ answer: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2xl">
        <div className="min-w-0 flex-1">
          <Input
            placeholder="Topic, e.g. system design"
            value={question.topic}
            onChange={(e) => onChange({ topic: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-lg">
          <span className="text-xs text-medium-gray">How confident?</span>
          <Rating label="Confidence" value={question.confidence} onChange={(n) => onChange({ confidence: n })} />
        </div>
      </div>
    </div>
  );
};

export default QuestionCard;
