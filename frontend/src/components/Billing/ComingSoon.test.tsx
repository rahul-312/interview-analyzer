import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ComingSoon from "./ComingSoon";
import type { Tier } from "@/models/Billing";
import { plansResponse } from "@/test/fixtures";

afterEach(cleanup);

const tiers = (change: (t: Tier) => Partial<Tier> = () => ({})): Tier[] =>
  plansResponse().tiers.map((t) => ({ ...t, ...change(t) }));
const action = { label: "Start free", href: "/register" };
const card = (name: string) => screen.getByRole("heading", { name: new RegExp(`^${name}`) }).parentElement!;

describe("ComingSoon", () => {
  it("previews each paid plan's allowances, model and training, without prices or buy buttons", () => {
    render(<ComingSoon tiers={tiers()} action={action} />);
    const pro = within(card("Pro Plus"));
    for (const label of ["AI round analyses", "AI prep plans", "AI model", "Debriefs used for training"]) {
      expect(pro.getByText(label)).toBeTruthy();
    }
    expect(pro.queryByText("Queue")).toBeNull();
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("leaves out the model row rather than naming the rule-based engine when there's no key for it", () => {
    render(<ComingSoon tiers={tiers(() => ({ ai_available: false, ai_model: "Rule-based engine" }))} action={action} />);
    expect(screen.queryByText("AI model")).toBeNull();
    expect(screen.queryByText("Rule-based engine")).toBeNull();
  });

  it("only says Free includes AI when the server can run it", () => {
    render(<ComingSoon tiers={tiers()} action={action} />);
    expect(screen.getByText(/with AI round analyses and prep plans included/)).toBeTruthy();
    cleanup();
    render(<ComingSoon tiers={tiers((t) => (t.code === "free" ? { ai_available: false } : {}))} action={action} />);
    expect(screen.queryByText(/AI round analyses and prep plans included/)).toBeNull();
    expect(screen.getByText(/debrief your rounds\./)).toBeTruthy();
  });
});
