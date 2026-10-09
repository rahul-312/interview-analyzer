export type Plan = "free" | "pro";

/** One limited job, over the last 24 hours. `limit` and `remaining` are null on unlimited plans. */
export interface Quota {
  limit: number | null;
  used: number;
  remaining: number | null;
  next_available_at: string | null;
}

export interface Usage {
  plan: Plan;
  analyses: Quota;
  prep_plans: Quota;
}

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  usage: Usage;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface RegisterInput {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
}
