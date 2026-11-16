import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import type { User } from "@/models/Auth";
import { apiClient } from "@/services/ApiClient";
import { authService, SessionCheckTimeout } from "@/services/AuthService";

const fakeLocation = { href: "/pricing", replace: vi.fn(), reload: vi.fn() };
const restoredFromCache = () => {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: true });
  act(() => void window.dispatchEvent(event));
};
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
  delete document.documentElement.dataset.leaving;
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

describe("a page restored by the Back button", () => {
  const showLoggedIn = async () => {
    vi.spyOn(authService, "restore").mockResolvedValue({ id: 1, usage: {} } as User);
    show();
    await screen.findByText("Logged in");
  };

  it("leaves if it held a user whose session ended in another tab", async () => {
    await showLoggedIn();
    vi.mocked(authService.hasToken).mockReturnValue(false);
    restoredFromCache();
    expect(fakeLocation.replace).toHaveBeenCalledWith("/login");
  });

  it("stays if the user is still logged in", async () => {
    await showLoggedIn();
    restoredFromCache();
    expect(fakeLocation.replace).not.toHaveBeenCalled();
    expect(fakeLocation.reload).not.toHaveBeenCalled();
  });

  it("reloads if it held no user but someone has logged in since", async () => {
    vi.mocked(authService.hasToken).mockReturnValue(false);
    show();
    await screen.findByText("Logged out");
    vi.mocked(authService.hasToken).mockReturnValue(true);
    restoredFromCache();
    expect(fakeLocation.reload).toHaveBeenCalledOnce();
  });

  it("shows public pages again after they were left by logging out", async () => {
    vi.mocked(authService.hasToken).mockReturnValue(false);
    show();
    await screen.findByText("Logged out");
    document.documentElement.dataset.leaving = "1";
    restoredFromCache();
    expect(document.documentElement.dataset.leaving).toBeUndefined();
  });

  it("stays if it's a public page that never held a user", async () => {
    vi.mocked(authService.hasToken).mockReturnValue(false);
    show();
    await screen.findByText("Logged out");
    restoredFromCache();
    expect(fakeLocation.replace).not.toHaveBeenCalled();
    expect(fakeLocation.reload).not.toHaveBeenCalled();
  });
});

describe("leaving for the login page", () => {
  it("clears the user before leaving, so the page Back restores holds no data", async () => {
    vi.spyOn(authService, "restore").mockResolvedValue({ id: 1, usage: {} } as User);
    show();
    await screen.findByText("Logged in");
    act(() => logout());
    await waitFor(() => expect(fakeLocation.href).toBe("/login"));
    expect(authService.logout).toHaveBeenCalledOnce();
    expect(screen.getByText("Logged out")).toBeTruthy();
    expect(document.documentElement.dataset.leaving).toBe("1");
  });

  it("clears the user when the session expires, too", async () => {
    vi.spyOn(authService, "restore").mockResolvedValue({ id: 1, usage: {} } as User);
    show();
    await screen.findByText("Logged in");
    act(() => apiClient.onSessionExpired?.());
    expect(screen.getByText("Logged out")).toBeTruthy();
    expect(document.documentElement.dataset.leaving).toBe("1");
  });
});
