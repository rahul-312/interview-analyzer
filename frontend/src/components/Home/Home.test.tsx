import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from ".";
import type { User } from "@/models/Auth";

const replace = vi.fn();
const auth = { user: null as User | null, ready: true };
vi.mock("next/router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.user = null;
  auth.ready = true;
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.session;
});

describe("Home", () => {
  it("shows logged-out visitors the page, with ways to sign up and log in", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("costing you the offer");
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/register");
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers the extension only once there's somewhere to install it", () => {
    render(<Home />);
    expect(screen.queryByRole("link", { name: "Install the extension" })).toBeNull();
    cleanup();

    vi.stubEnv("NEXT_PUBLIC_EXTENSION_URL", "https://example.test/extension");
    render(<Home />);
    expect(screen.getByRole("link", { name: "Install the extension" }).getAttribute("href")).toBe("https://example.test/extension");
    vi.unstubAllEnvs();
  });

  it("sends a confirmed user to the app", () => {
    auth.user = { id: 1 } as User;
    render(<Home />);
    expect(replace).toHaveBeenCalledWith("/applications");
  });

  it("keeps the page hidden and stays put while a saved session is being checked", () => {
    auth.ready = false;
    document.documentElement.dataset.session = "1";
    render(<Home />);
    expect(document.documentElement.dataset.session).toBe("1");
    expect(replace).not.toHaveBeenCalled();
  });

  it("puts the whole page, top bar included, inside what gets hidden", () => {
    const { container } = render(<Home />);
    const hidden = container.querySelector("[data-public-page]")!;
    expect(hidden.contains(screen.getByRole("link", { name: "Log in" }))).toBe(true);
    expect(hidden.contains(screen.getByRole("contentinfo"))).toBe(true);
    expect(hidden.contains(container.querySelector("[data-session-loading]"))).toBe(false);
  });

  it("shows the page when a saved session turns out to be over", () => {
    document.documentElement.dataset.session = "1";
    render(<Home />);
    expect(document.documentElement.dataset.session).toBeUndefined();
    expect(replace).not.toHaveBeenCalled();
  });
});
