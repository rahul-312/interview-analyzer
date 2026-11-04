import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";
import type { UpgradeQuote } from "@/models/Billing";
import { ApiError } from "@/services/ApiClient";
import { current, plansResponse } from "@/test/fixtures";

const refreshUser = vi.fn(async () => {});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ refreshUser }) }));
vi.mock("@/context/RefreshContext", () => ({ useRefresh: () => ({ key: 0 }) }));
vi.mock("@/services/BillingService", () => ({
  billingService: {
    plans: vi.fn(),
    current: vi.fn(),
    checkout: vi.fn(),
    verify: vi.fn(),
    changePlan: vi.fn(),
    upgradeQuote: vi.fn(),
  },
}));
const { billingService } = await import("@/services/BillingService");
const api = vi.mocked(billingService);

const checkoutConfig = {
  key_id: "rzp_test_key",
  subscription_id: "sub_1",
  plan: "pro_monthly",
  name: "Interview Analyzer",
  description: "Pro Monthly",
  starts_at: null,
  prefill: { name: "Alice", email: "alice@example.com" },
};
const paid = { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: "sig" };

/** A UPI subscriber's upgrade from Pro monthly, 10 days in. */
const upgradeQuote = (overrides: Partial<UpgradeQuote> = {}): UpgradeQuote => ({
  strategy: "replacement",
  plan: plansResponse().tiers[2].prices[0],
  available: true,
  charge_paise: 49900,
  credit_paise: 13266,
  credit_reason: "",
  currency: "INR",
  ...overrides,
});

type Options = { handler: (r: typeof paid) => void; modal: { ondismiss: () => void }; [key: string]: unknown };

/** Stands in for Razorpay Checkout; `behave` decides what the user does in it. */
function stubCheckout(behave: (options: Options, fail: (description: string) => void) => void) {
  const opened: Options[] = [];
  window.Razorpay = class {
    private failed?: (r: { error?: { description?: string } }) => void;
    constructor(private options: Options) {
      opened.push(options);
    }
    on(_event: string, handler: (r: { error?: { description?: string } }) => void) {
      this.failed = handler;
    }
    open() {
      setTimeout(() => behave(this.options, (description) => this.failed?.({ error: { description } })));
    }
  } as unknown as typeof window.Razorpay;
  return opened;
}

const card = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  api.plans.mockResolvedValue(plansResponse());
  api.current.mockResolvedValue(current());
});

afterEach(() => {
  cleanup();
  delete window.Razorpay;
  vi.useRealTimers();
});

describe("pricing page", () => {
  it("shows every plan with monthly prices and the feature comparison", async () => {
    render(<Pricing />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await screen.findByRole("heading", { name: /Pro Plus/ });

    expect(within(card("Free Current")).getByText("₹0")).toBeTruthy();
    expect(within(card("Pro")).getByText("₹199")).toBeTruthy();
    expect(within(card("Pro Plus")).getByText("₹499")).toBeTruthy();
    expect(within(card("Pro Plus")).getByText("Unlimited, fair use*")).toBeTruthy();
    expect(within(card("Pro Plus")).getByText("Better model (Pro-class)")).toBeTruthy();
    expect(within(card("Pro Plus")).getByText("Priority")).toBeTruthy();
    expect(within(card("Free Current")).getByText("Yes, with notice")).toBeTruthy();
    expect(within(card("Pro")).getAllByText("No").length).toBe(1);
    // The fair-use policy is stated with the real allowance.
    expect(screen.getByText(/up to 50 AI round analyses in any rolling 24 hours/)).toBeTruthy();
    expect(within(card("Free Current")).getByRole("button", { name: "Current plan" })).toHaveProperty("disabled", true);
  });

  it("switches to yearly prices", async () => {
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    const yearly = screen.getByRole("radio", { name: "Yearly" });
    await userEvent.click(yearly);
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    expect(within(card("Pro")).getByText("₹1,699")).toBeTruthy();
    expect(within(card("Pro Plus")).getByText("₹3,999")).toBeTruthy();
    expect(within(card("Free Current")).getByText(/No yearly plan needed/)).toBeTruthy();
  });

  it("subscribes: checkout, verify with the server, then shows the new plan", async () => {
    api.checkout.mockResolvedValue(checkoutConfig);
    api.verify.mockResolvedValue(current("pro_monthly"));
    const opened = stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });

    const button = within(card("Pro")).getByRole("button", { name: "Get Pro" });
    await userEvent.dblClick(button); // a double click must not start two checkouts

    expect(await screen.findByText(/You're on Pro/)).toBeTruthy();
    expect(api.checkout).toHaveBeenCalledTimes(1);
    expect(api.checkout).toHaveBeenCalledWith("pro_monthly");
    expect(opened[0]).toMatchObject({ key: "rzp_test_key", subscription_id: "sub_1" });
    expect(JSON.stringify(opened[0])).not.toMatch(/secret/i);
    expect(api.verify).toHaveBeenCalledWith(paid);
    expect(refreshUser).toHaveBeenCalled();
  });

  it("says nothing was charged when checkout is closed", async () => {
    api.checkout.mockResolvedValue(checkoutConfig);
    stubCheckout((options) => options.modal.ondismiss());
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));
    expect(await screen.findByText(/Checkout closed. You haven't been charged/)).toBeTruthy();
    expect(api.verify).not.toHaveBeenCalled();
  });

  it("shows why a payment failed", async () => {
    api.checkout.mockResolvedValue(checkoutConfig);
    stubCheckout((options, fail) => {
      fail("Your card was declined.");
      options.modal.ondismiss();
    });
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Your card was declined.");
  });

  it("waits for Razorpay to confirm, without treating the browser callback as payment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.checkout.mockResolvedValue(checkoutConfig);
    api.verify.mockResolvedValue(current(null, { subscription: null })); // not active yet
    api.current.mockResolvedValueOnce(current()).mockResolvedValue(current("pro_monthly"));
    stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));

    expect(await screen.findByText(/Razorpay is still confirming it/)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText(/You're on Pro/)).toBeTruthy();
  });

  it("says when a subscription bought to follow the current one starts", async () => {
    const ending = current("pro_monthly", {
      subscription: { ...current("pro_monthly").subscription!, cancel_at_period_end: true },
      actions: { ...current().actions, subscribe: true },
    });
    api.current.mockResolvedValue(ending);
    api.checkout.mockResolvedValue({ ...checkoutConfig, plan: "pro_plus_monthly", starts_at: "2026-11-01T00:00:00Z" });
    api.verify.mockResolvedValue({
      ...ending,
      upcoming: { ...current("pro_plus_monthly").subscription!, status: "authenticated", start_at: "2026-11-01T00:00:00Z" },
    });
    stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro Plus")).getByRole("button", { name: /Pro Plus/ }));
    expect(await screen.findByText(/subscription starts on/)).toBeTruthy();
    expect(api.current).toHaveBeenCalledTimes(1); // shown straight away, not after polling
  });

  it("treats an error after a verified payment as still confirming, not failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.checkout.mockResolvedValue(checkoutConfig);
    api.verify.mockResolvedValue(current(null, { subscription: null }));
    api.current.mockResolvedValueOnce(current()).mockRejectedValue(new ApiError(500, { detail: "Server error." }));
    stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText(/Razorpay is still confirming it/)).toBeTruthy();
    expect(screen.queryByText("Server error.")).toBeNull();
  });

  it("shows the server's error when checkout can't start", async () => {
    api.checkout.mockRejectedValue(new ApiError(409, { detail: "A subscription is already being set up." }));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already being set up");
  });

  it("upgrades a subscriber after confirming", async () => {
    api.current.mockResolvedValue(current("pro_monthly"));
    api.upgradeQuote.mockResolvedValue(upgradeQuote({ strategy: "native_change", charge_paise: null, credit_paise: 0 }));
    api.changePlan.mockResolvedValue({ ...current("pro_plus_monthly"), change: "now" });
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });

    expect(within(card("Pro Current")).getByRole("button", { name: "Current plan" })).toBeTruthy();
    await userEvent.click(within(card("Pro Plus")).getByRole("button", { name: "Upgrade to Pro Plus" }));
    const dialog = screen.getByRole("dialog", { name: "Change plan" });
    expect(dialog.textContent).toContain("now");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(api.changePlan).toHaveBeenCalledWith("pro_plus_monthly");
    expect(await screen.findByText("You're now on Pro Plus.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("upgrades a UPI subscriber by paying for the new plan, showing what comes back", async () => {
    api.current.mockResolvedValue(current("pro_monthly"));
    api.upgradeQuote.mockResolvedValue(upgradeQuote());
    api.changePlan.mockResolvedValue({
      ...current("pro_monthly"),
      change: "checkout",
      checkout: { ...checkoutConfig, plan: "pro_plus_monthly" },
    });
    api.verify.mockResolvedValue(current("pro_plus_monthly"));
    const opened = stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });

    await userEvent.click(within(card("Pro Plus")).getByRole("button", { name: "Upgrade to Pro Plus" }));
    const dialog = screen.getByRole("dialog", { name: "Change plan" });
    await within(dialog).findByText(/You'll pay ₹499 in Razorpay/);
    expect(dialog.textContent).toContain("About ₹132.66 for the unused days of your current plan is refunded");
    expect(api.upgradeQuote).toHaveBeenCalledWith("pro_plus_monthly");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue to payment" }));

    expect(await screen.findByText(/You're on Pro Plus/)).toBeTruthy();
    expect(api.changePlan).toHaveBeenCalledWith("pro_plus_monthly");
    expect(api.checkout).not.toHaveBeenCalled();
    expect(opened[0]).toMatchObject({ subscription_id: "sub_1" });
    expect(api.verify).toHaveBeenCalledWith(paid);
  });

  it("still upgrades when the quote can't load, paying in Checkout if the server asks", async () => {
    api.current.mockResolvedValue(current("pro_monthly"));
    api.upgradeQuote.mockRejectedValue(new ApiError(500, { detail: "Server error." }));
    api.changePlan.mockResolvedValue({ ...current("pro_monthly"), change: "checkout", checkout: checkoutConfig });
    api.verify.mockResolvedValue(current("pro_plus_monthly"));
    const opened = stubCheckout((options) => options.handler(paid));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro Plus")).getByRole("button", { name: "Upgrade to Pro Plus" }));
    const dialog = screen.getByRole("dialog", { name: "Change plan" });
    await within(dialog).findByText(/Couldn't load the upgrade details: Server error./);
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/You're on Pro Plus/)).toBeTruthy();
    expect(opened[0]).toMatchObject({ subscription_id: "sub_1" });
    expect(screen.queryByText(/You'll switch to/)).toBeNull();
  });

  it("counts a change from the subscription's plan, not a higher complimentary one", async () => {
    api.current.mockResolvedValue(
      current("pro_monthly", { plan: current("pro_plus_monthly").plan, source: "complimentary" }),
    );
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    // The subscription's own plan isn't offered as a switch, and Pro Plus is already the account's.
    expect(within(card("Pro")).getByRole("button", { name: "Current plan" })).toBeTruthy();
    expect(within(card("Pro Plus Current")).getByRole("button", { name: "Current plan" })).toBeTruthy();
  });

  it("doesn't offer an upgrade whose credit couldn't be refunded", async () => {
    api.current.mockResolvedValue(current("pro_yearly"));
    api.upgradeQuote.mockResolvedValue(upgradeQuote({ available: false, credit_paise: 0, credit_reason: "too_old" }));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro Plus")).getByRole("button", { name: "Upgrade to Pro Plus" }));
    const dialog = screen.getByRole("dialog", { name: "Change plan" });
    await within(dialog).findByText(/paid too long ago/);
    expect(within(dialog).queryByRole("button", { name: /Confirm|Continue/ })).toBeNull();
    expect(api.changePlan).not.toHaveBeenCalled();
  });

  it("can't be bought when payments aren't set up", async () => {
    api.plans.mockResolvedValue(plansResponse({ billing_enabled: false }));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    expect(within(card("Pro")).getByRole("button", { name: "Payments unavailable" })).toHaveProperty("disabled", true);
  });

  it("opens on the plan picked before signing up, and leaves buying to the user", async () => {
    render(<Pricing chosenPlan="pro_plus_yearly" />);
    const notice = await screen.findByText(/You picked Pro Plus/);
    expect(notice.textContent).toContain("/year");
    expect(within(card("Pro Plus")).getByText("₹3,999")).toBeTruthy();
    expect(api.checkout).not.toHaveBeenCalled();
  });

  it("ignores a picked plan it doesn't know, or one the user already has", async () => {
    render(<Pricing chosenPlan="nonsense" />);
    await screen.findByRole("region", { name: "Pro" });
    expect(screen.queryByText(/You picked/)).toBeNull();
    cleanup();

    api.current.mockResolvedValue(current("pro_monthly"));
    render(<Pricing chosenPlan="pro_monthly" />);
    await screen.findByRole("button", { name: "Current plan" });
    expect(screen.queryByText(/You picked/)).toBeNull();
  });

  it("shows an error when plans can't load", async () => {
    api.plans.mockRejectedValue(new Error("Network down"));
    render(<Pricing />);
    expect(await screen.findByText("Network down")).toBeTruthy();
  });
});
