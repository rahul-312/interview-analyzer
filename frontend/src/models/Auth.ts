export type Plan = "free" | "pro" | "pro_plus";

/** One limited job, over the last 24 hours. `limit` and `remaining` are null on unlimited plans. */
export interface Quota {
  limit: number | null;
  used: number;
  remaining: number | null;
  next_available_at: string | null;
  /** Shown as "Unlimited, fair use"; `limit` is the fair-use allowance the server enforces. */
  fair_use: boolean;
}

export interface Usage {
  plan: Plan;
  plan_name: string;
  /** False when this plan's jobs use the free rule-based engine (no suitable API key): nothing is limited. */
  ai_enabled: boolean;
  /** AI on with a free-tier Gemini key: Google may use what's sent to improve its products. */
  ai_free_tier: boolean;
  /** This plan's debriefs may be used for training (Free), which users must be told. */
  training_notice: boolean;
  /** "Flash" or "Better model (Pro-class)". */
  ai_model: string;
  /** Jobs skip ahead on the priority queue. */
  priority: boolean;
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
