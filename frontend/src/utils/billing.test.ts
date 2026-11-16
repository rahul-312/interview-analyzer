import { describe, expect, it } from "vitest";
import { allowanceText, formatPrice, perMonth, priceLabel, quotaText, subscriptionNotice } from "./billing";
import { current, price, subscription, usage } from "@/test/fixtures";

describe("prices", () => {
  it("formats paise as rupees", () => {
    expect(formatPrice(19900)).toBe("₹199");
    expect(formatPrice(169900)).toBe("₹1,699");
    expect(formatPrice(399900)).toBe("₹3,999");
    expect(formatPrice(0)).toBe("₹0");
  });

  it("labels a price with its period", () => {
    expect(priceLabel(price("pro_yearly"))).toBe("₹1,699/year");
    expect(perMonth(price("pro_yearly"))).toBe("₹142/month");
  });
});

describe("allowances", () => {
  it("says Unlimited, fair use for Pro Plus analyses, never a bare unlimited", () => {
    expect(allowanceText(50, true)).toBe("Unlimited, fair use");
    expect(allowanceText(15)).toBe("15 per 24 hours");
    expect(quotaText(usage("pro_plus").analyses)).toBe("Unlimited, fair use");
    expect(quotaText(usage("free").analyses)).toBe("1/2 left");
  });
});

describe("subscriptionNotice", () => {
  it("is quiet for a healthy subscription", () => {
    expect(subscriptionNotice(current("pro_monthly"))).toBeNull();
    expect(subscriptionNotice(current())).toBeNull();
  });

  it("warns about a failed renewal and says until when access lasts", () => {
    const notice = subscriptionNotice(
      current("pro_monthly", {
        subscription: subscription("pro_monthly", { status: "pending", access_until: "2026-11-04T00:00:00Z" }),
      })
    );
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toContain("retrying");
  });

  it("explains a halted subscription and a scheduled cancellation", () => {
    expect(subscriptionNotice(current("pro_monthly", { subscription: subscription("pro_monthly", { status: "halted" }) }))?.tone).toBe(
      "error"
    );
    const cancelled = subscriptionNotice(
      current("pro_monthly", {
        subscription: subscription("pro_monthly", { cancel_at_period_end: true, access_until: "2026-11-01T00:00:00Z" }),
      })
    );
    expect(cancelled?.text).toMatch(/cancelled.*keep it until/);
  });
});
