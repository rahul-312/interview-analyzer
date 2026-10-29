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
  /** False with no API key on the server: jobs use the free rule-based engine and nothing is limited. */
  ai_enabled: boolean;
  /** AI on with a free-tier Gemini key: Google may use what's sent to improve its products. */
  ai_free_tier: boolean;
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
