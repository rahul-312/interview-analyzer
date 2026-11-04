import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import type { User } from "@/models/Auth";
import { authService, SessionCheckTimeout } from "@/services/AuthService";

const fakeLocation = { href: "/pricing" };
let logout: () => void;

const Probe = () => {
  const auth = useAuth();
  logout = auth.logout;
  return <p>{auth.ready ? (auth.user ? "Logged in" : "Logged out") : "Checking"}</p>;
};

const show = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  vi.spyOn(authService, "hasToken").mockReturnValue(true);
  vi.spyOn(authService, "logout").mockImplementation(() => {});
  vi.stubGlobal("location", fakeLocation);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("restoring a session", () => {
  it("clears the tokens when the server turns it down", async () => {
    vi.spyOn(authService, "restore").mockRejectedValue(new Error("Unauthorized"));
    show();
    await screen.findByText("Logged out");
    expect(authService.logout).toHaveBeenCalledOnce();
  });

  it("keeps the tokens when the server doesn't answer in time", async () => {
    vi.spyOn(authService, "restore").mockRejectedValue(new SessionCheckTimeout());
    show();
    await screen.findByText("Logged out");
    expect(authService.logout).not.toHaveBeenCalled();
  });
});

describe("logging out", () => {
  it("leaves for the login page without rendering as logged out first", async () => {
    vi.spyOn(authService, "restore").mockResolvedValue({ id: 1, usage: {} } as User);
    show();
    await screen.findByText("Logged in");
    act(() => logout());
    await waitFor(() => expect(fakeLocation.href).toBe("/login"));
    expect(authService.logout).toHaveBeenCalledOnce();
    expect(screen.getByText("Logged in")).toBeTruthy();
  });
});
