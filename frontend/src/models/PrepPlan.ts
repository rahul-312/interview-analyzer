import type { GeneratedBy, JobStatus } from "./Common";

export interface PrepTask {
  id: number;
  date: string;
  topic: string;
  title: string;
  detail: string;
  minutes: number;
  done: boolean;
}

export interface PrepResource {
  title: string;
  url: string;
  kind: string;
  /** Why it's worth the time for this plan. */
  why: string;
}

export interface PrepPlan {
  id: number;
  application: number;
  company: string;
  role: string;
  target_round: number | null;
  target_round_label: string | null;
  interview_date: string;
  status: JobStatus;
  source: GeneratedBy;
  summary: string;
  /** Top resources to prepare from, best first (empty on plans made before this existed). */
  resources: PrepResource[];
  error: string;
  /** Failed for a reason that wasn't the user's, so it was given back. */
  refunded: boolean;
  tasks: PrepTask[];
  created_at: string;
}

export interface PrepPlanInput {
  application: number | "";
  target_round: number | null;
  interview_date?: string;
}
