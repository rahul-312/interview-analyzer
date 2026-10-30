import { describe, expect, it } from "vitest";
import { errorText } from "./errorText";

describe("errorText", () => {
  it("joins field errors", () => {
    expect(errorText({ role: ["This field is required."] })).toBe("role: This field is required.");
  });

  it("shows only the message of a usage-limit response", () => {
    const body = {
      detail: "You've used all 2 analyses allowed in 24 hours on the Free plan.",
      code: "usage_limit",
      feature: "ai_round_analysis",
      limit: 2,
      used: 2,
      reset_at: "2026-10-31T09:00:00Z",
    };
    expect(errorText(body)).toBe(body.detail);
  });
});
