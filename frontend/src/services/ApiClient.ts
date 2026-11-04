import { errorText } from "@/utils/errorText";

export const ACCESS_KEY = "ia_access";
const REFRESH_KEY = "ia_refresh";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(errorText(body) || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Send the user to /login when the session has expired. Off when the caller handles that itself. */
  redirectOnExpiry?: boolean;
}

/**
 * Talks to the Django API. Adds the JWT access token, refreshes it once on a 401,
 * and sends the user to /login when the refresh token has expired too.
 */
export default class ApiClient {
  private baseUrl: string;
  private refreshing: Promise<boolean> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  get accessToken() {
    return typeof window === "undefined" ? null : localStorage.getItem(ACCESS_KEY);
  }

  get refreshToken() {
    return typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  }

  setTokens(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  }

  clearTokens() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }

  private async refreshAccess(): Promise<boolean> {
    const refresh = this.refreshToken;
    if (!refresh) return false;

    // Share one refresh between requests that fail at the same time.
    this.refreshing ??= fetch(`${this.baseUrl}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        this.setTokens(data.access, data.refresh);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  private send(path: string, { method = "GET", body, auth = true }: RequestOptions) {
    // The browser's time zone, so the server's "today" (e.g. applying to a saved job) is the user's day.
    const headers: Record<string, string> = { "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    let res = await this.send(path, options);

    if (res.status === 401 && auth) {
      if (await this.refreshAccess()) {
        res = await this.send(path, options);
      } else {
        this.clearTokens();
        if (options.redirectOnExpiry !== false && typeof window !== "undefined" && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown, auth = true) {
    return this.request<T>(path, { method: "POST", body, auth });
  }

  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "PATCH", body });
  }

  delete(path: string) {
    return this.request<void>(path, { method: "DELETE" });
  }
}

export const apiClient = new ApiClient(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api");
