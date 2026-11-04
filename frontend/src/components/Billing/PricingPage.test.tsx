import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PricingPage from "@/pages/pricing";

// Lives here, not next to the page: every file under pages/ becomes a route.
const router = { query: {} as Record<string, string | string[]> };
const auth = { user: null as object | null };
vi.mock("next/router", () => ({ useRouter: () => router }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/Billing/Pricing", () => ({
  default: ({ chosenPlan }: { chosenPlan?: string }) => <p>In-app pricing: {chosenPlan ?? "none"}</p>,
}));
vi.mock("@/components/Billing/PublicPricing", () => ({ default: () => <p>Public pricing</p> }));
vi.mock("next/head", () => ({ default: () => null }));

afterEach(cleanup);

describe("the pricing page", () => {
  it("shows the public version when logged out", () => {
    auth.user = null;
    router.query = { plan: "pro_yearly" };
    render(<PricingPage plans={null} />);
    expect(screen.getByText("Public pricing")).toBeTruthy();
  });

  it("passes ?plan= to the in-app version", () => {
    auth.user = { id: 1 };
    router.query = { plan: "pro_yearly" };
    render(<PricingPage plans={null} />);
    expect(screen.getByText("In-app pricing: pro_yearly")).toBeTruthy();
  });

  it("ignores a repeated plan", () => {
    auth.user = { id: 1 };
    router.query = { plan: ["pro_yearly", "pro_monthly"] };
    render(<PricingPage plans={null} />);
    expect(screen.getByText("In-app pricing: none")).toBeTruthy();
  });
});
