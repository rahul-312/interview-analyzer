import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from ".";

const replace = vi.fn();
vi.mock("next/router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/services/AuthService", () => ({ authService: { hasToken: vi.fn() } }));
const { authService } = await import("@/services/AuthService");

afterEach(cleanup);

describe("Home", () => {
  it("shows logged-out visitors the page, with ways to sign up and log in", () => {
    vi.mocked(authService.hasToken).mockReturnValue(false);
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("costing you the offer");
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/register");
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends anyone with a session to the app", () => {
    vi.mocked(authService.hasToken).mockReturnValue(true);
    render(<Home />);
    expect(replace).toHaveBeenCalledWith("/applications");
  });
});
