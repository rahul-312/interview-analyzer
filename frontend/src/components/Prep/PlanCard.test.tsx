import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanCard from "./PlanCard";
import type { PrepPlan } from "@/models/PrepPlan";

vi.mock("@/hooks/useUsage", () => ({
  useUsage: () => ({ usage: { plan: "free", prep_plans: { remaining: 1 } }, reloadUsage: vi.fn() }),
}));
vi.mock("@/services/PrepPlanService", () => ({
  prepPlanService: { setTaskDone: vi.fn(), regenerate: vi.fn(), remove: vi.fn() },
}));
const { prepPlanService } = await import("@/services/PrepPlanService");
const api = vi.mocked(prepPlanService);

const plan = (overrides: Partial<PrepPlan> = {}): PrepPlan => ({
  id: 1, application: 1, company: "Tracxn", role: "Backend Developer", target_round: null, target_round_label: null,
  interview_date: "2099-01-01", status: "done", source: "ai", summary: "A plan.", resources: [], error: "", refunded: false,
  tasks: [{ id: 3, date: "2099-01-01", topic: "sql", title: "Review joins", detail: "", minutes: 30, done: false }],
  created_at: "2026-10-31T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("plan card", () => {
  it("ignores a second click on a task while its save is in flight", async () => {
    let finish = () => {};
    api.setTaskDone.mockReturnValue(new Promise((resolve) => { finish = () => resolve({} as never); }));
    render(<PlanCard plan={plan()} onChange={() => {}} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;

    await userEvent.dblClick(box);
    expect(api.setTaskDone).toHaveBeenCalledTimes(1);
    expect(api.setTaskDone).toHaveBeenCalledWith(3, true);
    expect(box.checked).toBe(true);

    finish();
    await userEvent.click(box); // once saved, clicks work again
    expect(api.setTaskDone).toHaveBeenLastCalledWith(3, false);
  });

  it("offers one Try again on a failed plan, without the ticked-tasks warning", async () => {
    api.regenerate.mockResolvedValue(undefined as never);
    const failed = plan({ status: "failed", error: "The AI is busy.", refunded: true, tasks: [{ ...plan().tasks[0], done: true }] });
    render(<PlanCard plan={failed} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.getByText("This didn't use up one of your prep plans.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.regenerate).toHaveBeenCalledWith(1);
  });

  it("keeps the spinner up until the reloaded plan arrives", async () => {
    api.regenerate.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { rerender } = render(<PlanCard plan={plan()} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onChange).toHaveBeenCalled();
    // The request is done but the old plan is still the prop: no flash of it
    expect(screen.getByText("Building your plan…")).toBeTruthy();
    expect(screen.queryByText("Review joins")).toBeNull();

    rerender(<PlanCard plan={plan({ status: "running" })} onChange={onChange} />);
    expect(screen.getByText("Building your plan…")).toBeTruthy();
    rerender(<PlanCard plan={plan({ tasks: [{ ...plan().tasks[0], title: "New task" }] })} onChange={onChange} />);
    expect(screen.getByText("New task")).toBeTruthy();
  });

  it("stops waiting if the reloaded plan never arrives", async () => {
    vi.useFakeTimers();
    api.regenerate.mockResolvedValue(undefined as never);
    render(<PlanCard plan={plan()} onChange={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Regenerate" })));
    expect(screen.getByText("Building your plan…")).toBeTruthy();

    // The page's reload failed, so the same plan stays the prop
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("Review joins")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Regenerate" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("drops the spinner and shows the error when regenerating is refused", async () => {
    const { ApiError } = await import("@/services/ApiClient");
    api.regenerate.mockRejectedValue(new ApiError(429, { detail: "No prep plans left." }));
    render(<PlanCard plan={plan()} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(screen.getByText("No prep plans left.")).toBeTruthy();
    expect(screen.getByText("Review joins")).toBeTruthy();
  });
});

describe("plan resources", () => {
  it("lists the plan's resources as outside links, skipping anything that isn't a web link", () => {
    render(<PlanCard plan={plan({ resources: [
      { title: "SQLBolt", url: "https://www.sqlbolt.com/", kind: "practice", why: "Interactive lessons.", source: "ai" },
      { title: "Use The Index, Luke", url: "https://use-the-index-luke.com", kind: "guide", why: "", source: "curated" },
      { title: "Sneaky", url: "javascript:alert(1)", kind: "guide", why: "" },
    ] })} onChange={() => {}} />);
    const link = screen.getByRole("link", { name: /SQLBolt/ });
    expect(link.getAttribute("href")).toBe("https://www.sqlbolt.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Interactive lessons.")).toBeTruthy();
    expect(screen.queryByText("Sneaky")).toBeNull();
    // Each link shows the site it opens, and only the AI pick is labelled as one
    expect(screen.getByText("sqlbolt.com")).toBeTruthy();
    expect(screen.getByText("use-the-index-luke.com")).toBeTruthy();
    expect(screen.getAllByText("AI-suggested")).toHaveLength(1);
  });

  it("shows no resources section on an older plan without any", () => {
    render(<PlanCard plan={plan()} onChange={() => {}} />);
    expect(screen.queryByText("Top resources to prepare from")).toBeNull();
  });
});
