import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Billing from ".";
import { ApiError } from "@/services/ApiClient";
import { current, payment, subscription } from "@/test/fixtures";

const refreshUser = vi.fn(async () => {});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ refreshUser }) }));
vi.mock("@/context/RefreshContext", () => ({ useRefresh: () => ({ key: 0 }) }));
vi.mock("@/services/BillingService", () => ({
  billingService: { current: vi.fn(), payments: vi.fn(), cancel: vi.fn(), resume: vi.fn() },
}));
const { billingService } = await import("@/services/BillingService");
const api = vi.mocked(billingService);

beforeEach(() => {
  api.current.mockResolvedValue(current("pro_monthly"));
  api.payments.mockResolvedValue([payment()]);
});

afterEach(cleanup);

describe("billing dashboard", () => {
  it("shows the plan, billing details, usage and payments", async () => {
    render(<Billing />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Pro" })).toBeTruthy();

    expect(screen.getByText("₹199/month")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    expect(screen.getByText("Next billing date")).toBeTruthy();
    expect(screen.getByText("14/15 left")).toBeTruthy();
    expect(screen.getByText("5/5 left")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "AI round analyses used" }).getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText(/next one frees up/)).toBeTruthy();
    expect(await screen.findByText("Pro monthly")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change plan" }).getAttribute("href")).toBe("/pricing");
  });

  it("shows empty payment history for a free user", async () => {
    api.current.mockResolvedValue(current());
    api.payments.mockResolvedValue([]);
    render(<Billing />);
    expect(await screen.findByText("No payments yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
  });

  it("cancels at the end of the period by default", async () => {
    const cancelled = current("pro_monthly", {
      subscription: subscription("pro_monthly", { cancel_at_period_end: true, access_until: "2026-11-01T00:00:00Z" }),
      actions: { subscribe: true, change_plan: false, cancel: false, cancel_at_period_end: false, resume: false, pay: false },
    });
    api.cancel.mockResolvedValue(cancelled);
    render(<Billing />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }));

    const dialog = screen.getByRole("dialog", { name: "Cancel subscription" });
    expect(within(dialog).getByRole("radio", { name: /At the end of the period/ })).toHaveProperty("checked", true);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel subscription" }));

    expect(api.cancel).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/keep it until the end of the period/)).toBeTruthy();
    expect(screen.getByText("Cancelled at period end")).toBeTruthy();
    expect(screen.getByText("Access until")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).toBeNull();
    expect(refreshUser).toHaveBeenCalled();
  });

  it("can cancel straight away", async () => {
    api.cancel.mockResolvedValue(current(null, { subscription: subscription("pro_monthly", { status: "cancelled", status_label: "Cancelled", gives_access: false }) }));
    render(<Billing />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /Now/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel subscription" }));
    expect(api.cancel).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/You're on Free now/)).toBeTruthy();
  });

  it("offers a way to fix a failed payment", async () => {
    const failing = current("pro_monthly", {
      subscription: subscription("pro_monthly", { status: "halted", status_label: "Halted", gives_access: false }),
      actions: { subscribe: false, change_plan: false, cancel: true, cancel_at_period_end: false, resume: false, pay: true },
    });
    api.current.mockResolvedValue(failing);
    api.resume.mockResolvedValue({ ...failing, payment_url: "https://rzp.io/i/sub_1" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Billing />);

    expect((await screen.findByRole("alert")).textContent).toContain("paid features are paused");
    await userEvent.click(screen.getByRole("button", { name: "Update payment" }));
    expect(open).toHaveBeenCalledWith("https://rzp.io/i/sub_1", "_blank", "noopener,noreferrer");
  });

  it("shows the server's error and reloads stale data when an action fails", async () => {
    api.cancel.mockRejectedValue(new ApiError(409, { detail: "This subscription is already set to end with its current period." }));
    render(<Billing />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel subscription" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel subscription" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already set to end");
    expect(api.current).toHaveBeenCalledTimes(2);
  });

  it("shows an error when the plan can't load", async () => {
    api.current.mockRejectedValue(new Error("Network down"));
    render(<Billing />);
    expect(await screen.findByText("Network down")).toBeTruthy();
  });
});
