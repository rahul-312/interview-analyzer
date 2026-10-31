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
  billingService: { current: vi.fn(), payments: vi.fn(), cancel: vi.fn(), cancelUpcoming: vi.fn(), resume: vi.fn() },
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
      actions: { ...current().actions, subscribe: true, change_plan: false, cancel: false, cancel_at_period_end: false },
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
      actions: { ...current().actions, subscribe: false, change_plan: false, cancel: true, cancel_at_period_end: false, pay: true },
    });
    api.current.mockResolvedValue(failing);
    api.resume.mockResolvedValue({ ...failing, payment_url: "https://rzp.io/i/sub_1" });
    const tab = { opener: window as Window | null, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    render(<Billing />);

    expect((await screen.findByRole("alert")).textContent).toContain("paid features are paused");
    await userEvent.click(screen.getByRole("button", { name: "Update payment" }));
    // Opened during the click, so popup blockers allow it, then sent to Razorpay.
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(await screen.findByText(/Razorpay opened in a new tab/)).toBeTruthy();
    expect(tab.location.href).toBe("https://rzp.io/i/sub_1");
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the tab it opened when the payment link can't be fetched", async () => {
    const failing = current("pro_monthly", {
      subscription: subscription("pro_monthly", { status: "halted", status_label: "Halted", gives_access: false }),
      actions: { ...current().actions, subscribe: false, change_plan: false, cancel: true, pay: true },
    });
    api.current.mockResolvedValue(failing);
    api.resume.mockRejectedValue(new ApiError(502, { detail: "Couldn't reach the payment provider. Try again." }));
    const tab = { opener: null, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window);
    render(<Billing />);
    await userEvent.click(await screen.findByRole("button", { name: "Update payment" }));
    expect(await screen.findByText(/Couldn't reach the payment provider/)).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
  });

  it("can cancel a subscription that hasn't started yet", async () => {
    const withUpcoming = current("pro_monthly", {
      subscription: subscription("pro_monthly", { cancel_at_period_end: true, access_until: "2026-11-01T00:00:00Z" }),
      upcoming: subscription("pro_yearly", { status: "authenticated", status_label: "Authorised", gives_access: false, start_at: "2026-11-01T00:00:00Z" }),
      actions: { ...current().actions, subscribe: false, cancel_upcoming: true },
    });
    api.current.mockResolvedValue(withUpcoming);
    api.cancelUpcoming.mockResolvedValue({ ...withUpcoming, upcoming: null, actions: { ...withUpcoming.actions, cancel_upcoming: false } });
    render(<Billing />);

    expect(await screen.findByText(/subscription starts on/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel upcoming subscription" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel upcoming subscription" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel upcoming subscription" }));

    expect(api.cancelUpcoming).toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
    expect(await screen.findByText(/You won't be charged for it/)).toBeTruthy();
    expect(screen.queryByText(/subscription starts on/)).toBeNull();
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
