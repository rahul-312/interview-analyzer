import type { PrepPlan, PrepPlanInput, PrepTask } from "@/models/PrepPlan";
import ApiClient, { apiClient } from "./ApiClient";

export default class PrepPlanService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  list() {
    return this.client.get<PrepPlan[]>("/prep-plans/");
  }

  create(input: PrepPlanInput) {
    return this.client.post<PrepPlan>("/prep-plans/", input);
  }

  regenerate(id: number) {
    return this.client.post(`/prep-plans/${id}/regenerate/`);
  }

  remove(id: number) {
    return this.client.delete(`/prep-plans/${id}/`);
  }

  setTaskDone(taskId: number, done: boolean) {
    return this.client.patch<PrepTask>(`/prep-tasks/${taskId}/`, { done });
  }
}

export const prepPlanService = new PrepPlanService(apiClient);
