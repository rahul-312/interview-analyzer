import type { Debrief, DebriefDraft, DebriefQuestion } from "@/models/Interview";

const TEXT_KEYS = ["went_well", "went_badly", "interviewer_cues", "recruiter_feedback"] as const;

const hasContent = (q: DebriefQuestion) => Boolean(q.question.trim() || q.answer.trim() || q.topic.trim());

/**
 * Adds a voice draft to what's already in the form without losing anything typed:
 * new questions go after the filled-in ones (blank question cards are dropped), notes are
 * appended to existing text, and a rating already picked is kept.
 */
export function mergeDraft(current: Debrief, draft: DebriefDraft): Debrief {
  const kept = current.questions.filter(hasContent);
  const merged: Debrief = {
    ...current,
    questions: draft.questions.length ? [...kept, ...draft.questions] : current.questions,
    overall_feeling: current.overall_feeling ?? draft.overall_feeling,
  };
  for (const key of TEXT_KEYS) {
    const mine = current[key].trim();
    const spoken = draft[key].trim();
    if (spoken) merged[key] = mine ? `${mine}\n\n${spoken}` : spoken;
  }
  return merged;
}
