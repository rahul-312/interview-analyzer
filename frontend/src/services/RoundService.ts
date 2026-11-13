import type { DebriefDraft, InterviewRound, RoundInput, RoundSaveResult } from "@/models/Interview";
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
    return this.client.post<RoundSaveResult>("/rounds/", input);
  }

  update(id: number, input: Partial<RoundInput>) {
    return this.client.patch<RoundSaveResult>(`/rounds/${id}/`, input);
  }

  remove(id: number | string) {
    return this.client.delete(`/rounds/${id}/`);
  }

  // A draft debrief from a spoken recap. Nothing is saved: the form is filled for the user to check.
  debriefFromVoice(audio: Blob) {
    const form = new FormData();
    // A file name whose extension matches the type, for logs and proxies that look at it.
    const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "m4a" : "webm";
    form.append("audio", audio, `debrief.${ext}`);
    return this.client.post<DebriefDraft>("/rounds/debrief-from-voice/", form);
  }

  // Run the analysis for a round that has a debrief (counts against the daily limit)
  analyze(id: number | string) {
    return this.client.post(`/rounds/${id}/analyze/`);
  }
}

export const roundService = new RoundService(apiClient);
