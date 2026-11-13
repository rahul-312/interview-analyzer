import type { GeneratedBy, JobStatus } from "./Common";

export type RoundType =
  | "phone_screen"
  | "technical"
  | "system_design"
  | "behavioral"
  | "hiring_manager"
  | "take_home"
  | "onsite"
  | "other";

export type Outcome = "pending" | "passed" | "failed";

export type Severity = "low" | "medium" | "high";

export interface DebriefQuestion {
  question: string;
  answer: string;
  topic: string;
  confidence: number | null;
}

export interface Debrief {
  questions: DebriefQuestion[];
  went_well: string;
  went_badly: string;
  interviewer_cues: string;
  recruiter_feedback: string;
  overall_feeling: number | null;
  updated_at?: string;
}

/** A debrief written up from a voice recording, before the user checks and saves it. */
export type DebriefDraft = Omit<Debrief, "updated_at">;

export interface Weakness {
  topic: string;
  severity: Severity;
  evidence: string;
  advice: string;
}

export interface AnswerReview {
  question: string;
  verdict: string;
  better_answer: string;
}

export interface Analysis {
  status: JobStatus;
  source: GeneratedBy;
  summary: string;
  score: number | null;
  strengths: string[];
  weaknesses: Weakness[];
  answer_reviews: AnswerReview[];
  error: string;
  /** The debrief changed after this ran and no new analysis could start. */
  stale: boolean;
  /** Failed for a reason that wasn't the user's, so it was given back. */
  refunded: boolean;
  updated_at: string;
}

export interface InterviewRound {
  id: number;
  application: number;
  company: string;
  role: string;
  round_type: RoundType;
  round_type_label: string;
  scheduled_at: string;
  interviewer: string;
  outcome: Outcome;
  debrief: Debrief | null;
  analysis: Analysis | null;
  created_at: string;
}

/** What saving a round returns: the round, plus whether the daily analysis limit stopped an analysis. */
export interface RoundSaveResult extends InterviewRound {
  analysis_limited: boolean;
  analysis_limit_message?: string;
}

export interface RoundInput {
  application: number | "";
  round_type: RoundType;
  scheduled_at: string;
  interviewer: string;
  outcome: Outcome;
  debrief?: Omit<Debrief, "updated_at">;
}
