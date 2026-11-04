import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MainLayout from ".";

const replace = vi.fn();
const router = { pathname: "/", replace };
const auth = { user: null as object | null, ready: true };
vi.mock("next/router", () => ({ useRouter: () => router }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/context/DialogsContext", () => ({ DialogsProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/useAddApplication", () => ({ useAddApplication: () => () => {} }));
vi.mock("@/hooks/useSidebarCollapsed", () => ({ useSidebarCollapsed: () => ({ collapsed: false, toggle: () => {} }) }));
vi.mock("../Navbar", () => ({ default: () => <nav>App navbar</nav> }));
vi.mock("../Navbar/Sidebar", () => ({ default: () => null }));

const show = (pathname: string) => {
  router.pathname = pathname;
  render(<MainLayout>Page</MainLayout>);
};

beforeEach(() => {
  auth.user = null;
  auth.ready = true;
});

afterEach(cleanup);

describe("MainLayout", () => {
  it("sends logged-out visitors from private pages to login, and shows them nothing", () => {
    show("/applications");
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("Page")).toBeNull();
  });

  it.each(["/", "/login", "/register", "/pricing"])("leaves logged-out visitors on %s, without the app", (path) => {
    show(path);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.queryByText("App navbar")).toBeNull();
  });

  it("shows pricing inside the app when logged in", () => {
    auth.user = { id: 1 };
    show("/pricing");
    expect(screen.getByText("App navbar")).toBeTruthy();
    expect(screen.getByText("Page")).toBeTruthy();
  });

  it("renders pricing while the session is checked, so it's in the prerendered page", () => {
    auth.ready = false;
    show("/pricing");
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.queryByText("App navbar")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits on private pages while the session is checked", () => {
    auth.ready = false;
    show("/applications");
    expect(screen.queryByText("Page")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
