import type { RegisterInput, TokenPair, User } from "@/models/Auth";
import ApiClient, { apiClient } from "./ApiClient";

const SESSION_CHECK_TIMEOUT_MS = 15000;

/** The server didn't answer in time, which says nothing about the session itself. */
export class SessionCheckTimeout extends Error {}

export default class AuthService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  hasToken() {
    return Boolean(this.client.accessToken);
  }

  // Log in and store the tokens
  async login(username: string, password: string) {
    const tokens = await this.client.post<TokenPair>("/auth/token/", { username, password }, false);
    this.client.setTokens(tokens.access, tokens.refresh);
    return this.me();
  }

  // Create an account, then log straight in
  async register(input: RegisterInput) {
    await this.client.post("/auth/register/", input, false);
    return this.login(input.username, input.password);
  }

  me() {
    return this.client.get<User>("/auth/me/");
  }

  /** Loads the user for a saved session. An expired one just fails: public pages stay open. */
  async restore() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SessionCheckTimeout()), SESSION_CHECK_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.client.request<User>("/auth/me/", { redirectOnExpiry: false }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  onSessionExpired(callback: () => void) {
    this.client.onSessionExpired = callback;
  }

  logout() {
    this.client.clearTokens();
  }
}

export const authService = new AuthService(apiClient);
