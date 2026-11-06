import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiClient, { ACCESS_KEY } from "./ApiClient";
import AuthService, { SessionCheckTimeout } from "./AuthService";

const service = new AuthService(new ApiClient("http://api.test"));
const fakeLocation = { pathname: "/pricing", href: "http://app.test/pricing" };

beforeEach(() => {
  localStorage.setItem(ACCESS_KEY, "expired");
  localStorage.setItem("ia_refresh", "expired");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  vi.stubGlobal("location", fakeLocation);
  fakeLocation.href = "http://app.test/pricing";
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("an expired session", () => {
  it("restoring it fails and clears the tokens, without leaving the page", async () => {
    await expect(service.restore()).rejects.toThrow();
    expect(service.hasToken()).toBe(false);
    expect(fakeLocation.href).toBe("http://app.test/pricing");
  });

  it("gives up on a server that doesn't answer, and keeps the tokens", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const check = expect(service.restore()).rejects.toBeInstanceOf(SessionCheckTimeout);
    await vi.advanceTimersByTimeAsync(15000);
    await check;
    vi.useRealTimers();
    expect(service.hasToken()).toBe(true);
  });

  it("any other request still goes to login, saying so first", async () => {
    const hrefWhenTold: string[] = [];
    service.onSessionExpired(() => hrefWhenTold.push(fakeLocation.href));
    await expect(service.me()).rejects.toThrow();
    expect(fakeLocation.href).toBe("/login");
    expect(hrefWhenTold).toEqual(["http://app.test/pricing"]);
  });
});
