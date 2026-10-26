'use client';

import React from 'react';
import ScoreRing from './ScoreRing';
import { SeverityBadge } from '../../Badges';
import Card from '../../ui/Card';
import type { Analysis } from '@/models/Interview';

/** A finished analysis: score and summary, what went wrong, what went well, and answer by answer. */
const AnalysisResult: React.FC<{ analysis: Analysis }> = ({ analysis }) => {
  return (
    <>
      {/* Score and summary */}
      <Card className="flex flex-col gap-6xl md:flex-row md:items-center">
        <ScoreRing score={analysis.score ?? 0} />
        <div className="flex flex-col gap-lg">
          <p className="text-charcoal-gray">{analysis.summary}</p>
          {analysis.source === 'rules' && (
            <p className="rounded-lg bg-amber-light px-2xl py-lg text-xs text-amber-dark">
              This review used the rule-based analyzer (based on your confidence ratings). Add a Gemini API key on the
              server for a full AI review with stronger answers.
            </p>
          )}
        </div>
      </Card>

      {/* What went wrong */}
      <section className="flex flex-col gap-2xl">
        <h2 className="text-lg font-semibold">What went wrong</h2>
        {analysis.weaknesses.length === 0 ? (
          <Card className="text-sm text-medium-gray">No weak spots found in this round.</Card>
        ) : (
          analysis.weaknesses.map((w, i) => (
            <Card key={i} className="flex flex-col gap-lg">
              <div className="flex items-center gap-lg">
                <span className="font-medium capitalize">{w.topic}</span>
                <SeverityBadge severity={w.severity} />
              </div>
              <p className="text-sm text-dark-gray">{w.evidence}</p>
              <p className="rounded-lg bg-primary-light px-2xl py-lg text-sm text-primary-dark">
                <span className="font-medium">Fix: </span>
                {w.advice}
              </p>
            </Card>
          ))
        )}
      </section>

      {/* What went well */}
      {analysis.strengths.length > 0 && (
        <section className="flex flex-col gap-2xl">
          <h2 className="text-lg font-semibold">What went well</h2>
          <Card>
            <ul className="flex list-disc flex-col gap-sm pl-6xl text-sm text-charcoal-gray">
              {analysis.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Answer by answer */}
      {analysis.answer_reviews.length > 0 && (
        <section className="flex flex-col gap-2xl">
          <h2 className="text-lg font-semibold">Answer by answer</h2>
          {analysis.answer_reviews.map((r, i) => (
            <Card key={i} className="flex flex-col gap-lg">
              <p className="font-medium">{r.question}</p>
              <p className="text-sm text-dark-gray">{r.verdict}</p>
              {r.better_answer && (
                <div className="rounded-lg bg-pale-mint px-2xl py-lg text-sm text-deep-green">
                  <span className="font-medium">A stronger answer: </span>
                  {r.better_answer}
                </div>
              )}
            </Card>
          ))}
        </section>
      )}
    </>
  );
};

export default AnalysisResult;
