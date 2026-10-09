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
  error: string;
  tasks: PrepTask[];
  created_at: string;
}

export interface PrepPlanInput {
  application: number | "";
  target_round: number | null;
  interview_date?: string;
}
