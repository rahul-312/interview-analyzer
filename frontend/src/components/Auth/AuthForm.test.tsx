import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthForm from "./AuthForm";

const replace = vi.fn();
const router = { query: {} as Record<string, string | string[]>, replace };
const auth = { user: { id: 1 } as object | null, ready: true };
vi.mock("next/router", () => ({ useRouter: () => router }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.user = { id: 1 };
});

afterEach(cleanup);

const destination = (query: Record<string, string | string[]>) => {
  router.query = query;
  render(<AuthForm mode="login" />);
  return replace.mock.lastCall?.[0];
};

describe("AuthForm redirect", () => {
  it("goes to the app by default", () => {
    expect(destination({})).toBe("/applications");
  });

  it("goes back to pricing, with the chosen plan", () => {
    expect(destination({ next: "/pricing" })).toBe("/pricing");
    cleanup();
    expect(destination({ next: "/pricing", plan: "pro_plus_yearly" })).toBe("/pricing?plan=pro_plus_yearly");
  });

  it.each([
    ["an external address", "https://evil.com"],
    ["a protocol-relative address", "//evil.com"],
    ["another page", "/billing"],
    ["a repeated value", ["/pricing", "/pricing"]],
  ])("ignores next when it's %s", (_, next) => {
    expect(destination({ next })).toBe("/applications");
  });

  it("drops a plan that isn't a plan code", () => {
    expect(destination({ next: "/pricing", plan: "x&next=//evil.com" })).toBe("/pricing");
  });

  it("ignores a plan without next", () => {
    expect(destination({ plan: "pro_monthly" })).toBe("/applications");
  });

  it("keeps the return address on the link to the other form", () => {
    auth.user = null;
    router.query = { next: "/pricing", plan: "pro_monthly" };
    render(<AuthForm mode="login" />);
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
      "/register?next=%2Fpricing&plan=pro_monthly"
    );
  });
});
