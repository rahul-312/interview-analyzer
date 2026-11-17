import { describe, expect, it, vi } from "vitest";
import { legal } from "@/config/legal";
import { billingService } from "@/services/BillingService";
import type { PlansResponse } from "@/models/Billing";
import { billingDays } from "./legal";

vi.mock("@/services/BillingService", () => ({ billingService: { publicPlans: vi.fn() } }));
const publicPlans = vi.mocked(billingService.publicPlans);

describe("billingDays", () => {
  it("uses the server's refund and grace days, so the policies match billing", async () => {
    publicPlans.mockResolvedValue({ tiers: [], billing_enabled: true, refund_days: 14, grace_days: 5 } as PlansResponse);
    expect(await billingDays()).toEqual({ refundDays: 14, graceDays: 5 });
  });

  it("falls back to the defaults when the API can't be reached", async () => {
    publicPlans.mockRejectedValue(new Error("down"));
    expect(await billingDays()).toEqual({ refundDays: legal.refundDays, graceDays: legal.graceDays });
  });
});
