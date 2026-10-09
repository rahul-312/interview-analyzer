import type { Insights } from "@/models/Insights";
import ApiClient, { apiClient } from "./ApiClient";

export default class InsightsService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  // Weak spots, pass rates by round type, and the application funnel
  get() {
    return this.client.get<Insights>("/insights/");
  }
}

export const insightsService = new InsightsService(apiClient);
