import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicPricing from "./PublicPricing";
import { plansResponse } from "@/test/fixtures";

vi.mock("@/context/RefreshContext", () => ({ useRefresh: () => ({ key: 0 }) }));
vi.mock("@/services/BillingService", () => ({ billingService: { plans: vi.fn(), current: vi.fn() } }));
const { billingService } = await import("@/services/BillingService");
const api = vi.mocked(billingService);

afterEach(cleanup);

describe("PublicPricing", () => {
  it("sends Free to sign-up and paid plans through sign-up and back, without asking for the account", async () => {
    api.plans.mockResolvedValue(plansResponse());
    render(<PublicPricing />);
    expect((await screen.findByRole("link", { name: "Get started" })).getAttribute("href")).toBe("/register");
    expect(screen.getByRole("link", { name: "Get Pro Plus" }).getAttribute("href")).toBe("/register?next=/pricing&plan=pro_plus_monthly");
    expect(api.current).not.toHaveBeenCalled();
  });

  it("doesn't offer paid plans when payments are off", async () => {
    api.plans.mockResolvedValue(plansResponse({ billing_enabled: false }));
    render(<PublicPricing />);
    expect(await screen.findByText(/Payments aren't set up/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Get Pro Plus" })).toBeNull();
  });

  it("shows an error when plans can't load", async () => {
    api.plans.mockRejectedValue(new Error("Network down"));
    render(<PublicPricing />);
    expect(await screen.findByText("Network down")).toBeTruthy();
  });
});
