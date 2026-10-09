import React from 'react';
import Card from '../../ui/Card';
import type { Debrief } from '@/models/Interview';

/** A collapsible copy of what the candidate wrote. */
const DebriefSummary: React.FC<{ debrief: Debrief }> = ({ debrief }) => {
  const notes = [
    { label: 'Went well', value: debrief.went_well },
    { label: 'Went badly', value: debrief.went_badly },
    { label: 'Interviewer cues', value: debrief.interviewer_cues },
    { label: 'Recruiter feedback', value: debrief.recruiter_feedback },
  ].filter((n) => n.value);

  return (
    <Card>
      <details>
        <summary className="cursor-pointer font-medium">Your debrief</summary>
        <div className="mt-4xl flex flex-col gap-4xl text-sm">
          {/* Questions */}
          {debrief.questions.map((q, i) => (
            <div key={i}>
              <p className="font-medium">
                {q.question}
                {q.confidence && <span className="ml-lg text-xs text-medium-gray">confidence {q.confidence}/5</span>}
              </p>
              {q.topic && <p className="text-xs text-medium-gray">{q.topic}</p>}
              {q.answer && <p className="mt-sm whitespace-pre-line text-dark-gray">{q.answer}</p>}
            </div>
          ))}

          {/* Notes */}
          {notes.map((n) => (
            <div key={n.label}>
              <p className="text-xs font-medium tracking-wide text-medium-gray uppercase">{n.label}</p>
              <p className="whitespace-pre-line text-charcoal-gray">{n.value}</p>
            </div>
          ))}
          {debrief.overall_feeling && <p className="text-medium-gray">Overall feeling: {debrief.overall_feeling}/5</p>}
        </div>
      </details>
    </Card>
  );
};

export default DebriefSummary;
