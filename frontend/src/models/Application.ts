export type AppStatus = "saved" | "applied" | "screening" | "interview" | "offer" | "rejected" | "withdrawn";

export type Source = "" | "cold" | "referral" | "recruiter" | "job_board" | "other";

export interface ApplicationInput {
  company: string;
  role: string;
  date_applied: string;
  status: AppStatus;
  job_url: string;
  salary: string;
  source: Source;
  contact: string;
  notes: string;
  job_description: string;
}

export interface Application extends ApplicationInput {
  id: number;
  status_label: string;
  /** When it was actually applied to. Null while only saved, or if it never was. */
  applied_at: string | null;
  /** When it was saved for later, if it ever was. */
  saved_at: string | null;
  rounds_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicationFilters {
  search?: string;
  status?: AppStatus;
}
