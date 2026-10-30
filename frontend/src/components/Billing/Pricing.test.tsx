import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";
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

  it("shows the server's error when checkout can't start", async () => {
    api.checkout.mockRejectedValue(new ApiError(409, { detail: "A subscription is already being set up." }));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    await userEvent.click(within(card("Pro")).getByRole("button", { name: "Get Pro" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already being set up");
  });

  it("upgrades a subscriber after confirming", async () => {
    api.current.mockResolvedValue(current("pro_monthly"));
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

  it("can't be bought when payments aren't set up", async () => {
    api.plans.mockResolvedValue(plansResponse({ billing_enabled: false }));
    render(<Pricing />);
    await screen.findByRole("heading", { name: /Pro Plus/ });
    expect(within(card("Pro")).getByRole("button", { name: "Payments unavailable" })).toHaveProperty("disabled", true);
  });

  it("shows an error when plans can't load", async () => {
    api.plans.mockRejectedValue(new Error("Network down"));
    render(<Pricing />);
    expect(await screen.findByText("Network down")).toBeTruthy();
  });
});
