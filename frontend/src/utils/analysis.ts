import type { InterviewRound } from "@/models/Interview";

/** True while a round's analysis is queued or running. */
export function isAnalysing(round: InterviewRound): boolean {
  return Boolean(round.analysis && ["pending", "running"].includes(round.analysis.status));
}

export function anyAnalysing(rounds: InterviewRound[]): boolean {
  return rounds.some(isAnalysing);
}
