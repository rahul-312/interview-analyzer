import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiClient, { ACCESS_KEY } from "./ApiClient";
import AuthService from "./AuthService";

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

  it("any other request still goes to login", async () => {
    await expect(service.me()).rejects.toThrow();
    expect(fakeLocation.href).toBe("/login");
  });
});
