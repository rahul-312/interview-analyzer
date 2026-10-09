import type { InterviewRound, RoundInput } from "@/models/Interview";
import ApiClient, { apiClient } from "./ApiClient";

export default class RoundService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  list(applicationId?: number | string) {
    return this.client.get<InterviewRound[]>(applicationId ? `/rounds/?application=${applicationId}` : "/rounds/");
  }

  get(id: number | string) {
    return this.client.get<InterviewRound>(`/rounds/${id}/`);
  }

  // Sending `debrief` saves it and queues an analysis
  create(input: RoundInput) {
    return this.client.post<InterviewRound>("/rounds/", input);
  }

  update(id: number, input: Partial<RoundInput>) {
    return this.client.patch<InterviewRound>(`/rounds/${id}/`, input);
  }

  remove(id: number | string) {
    return this.client.delete(`/rounds/${id}/`);
  }

  // Re-run the analysis for a round that has a debrief
  analyze(id: number | string) {
    return this.client.post(`/rounds/${id}/analyze/`);
  }
}

export const roundService = new RoundService(apiClient);
