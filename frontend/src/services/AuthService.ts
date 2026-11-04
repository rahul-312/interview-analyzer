import type { RegisterInput, TokenPair, User } from "@/models/Auth";
import ApiClient, { apiClient } from "./ApiClient";

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
  restore() {
    return this.client.request<User>("/auth/me/", { redirectOnExpiry: false });
  }

  logout() {
    this.client.clearTokens();
  }
}

export const authService = new AuthService(apiClient);
