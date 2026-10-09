import type { Application, ApplicationFilters, ApplicationInput } from "@/models/Application";
import ApiClient, { apiClient } from "./ApiClient";

export default class ApplicationService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  list(filters: ApplicationFilters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    return this.client.get<Application[]>(`/applications/${query ? `?${query}` : ""}`);
  }

  get(id: number | string) {
    return this.client.get<Application>(`/applications/${id}/`);
  }

  create(input: ApplicationInput) {
    return this.client.post<Application>("/applications/", input);
  }

  update(id: number, input: Partial<ApplicationInput>) {
    return this.client.patch<Application>(`/applications/${id}/`, input);
  }

  remove(id: number) {
    return this.client.delete(`/applications/${id}/`);
  }
}

export const applicationService = new ApplicationService(apiClient);
