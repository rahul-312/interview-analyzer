import type { AppStatus } from "./Application";
import type { RoundType } from "./Interview";

export interface WeakSpotRound {
  id: number;
  company: string;
  round_type: string;
  date: string;
}

export interface WeakSpot {
  topic: string;
  score: number;
  count: number;
  high_count: number;
  latest_advice: string;
  rounds: WeakSpotRound[];
}

export interface RoundOutcomeRow {
  round_type: RoundType;
  label: string;
  passed: number;
  failed: number;
  pending: number;
  pass_rate: number | null;
}

export interface FunnelStage {
  stage: AppStatus;
  label: string;
  count: number;
  conversion: number | null;
}

export interface SourceRow {
  source: string;
  label: string;
  total: number;
  interviews: number;
  offers: number;
}

export interface Funnel {
  stages: FunnelStage[];
  by_source: SourceRow[];
  status_counts: Partial<Record<AppStatus, number>>;
  total: number;
}

export interface Insights {
  weak_spots: WeakSpot[];
  round_outcomes: { by_type: RoundOutcomeRow[]; weakest: string | null };
  funnel: Funnel;
  analysed_rounds: number;
  ai_enabled: boolean;
}
