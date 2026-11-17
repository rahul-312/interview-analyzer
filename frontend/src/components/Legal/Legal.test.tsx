import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Contact from "./Contact";
import Privacy from "./Privacy";
import RefundPolicy from "./RefundPolicy";
import ShippingPolicy from "./ShippingPolicy";
import Terms from "./Terms";
import { legal, legalLinks } from "@/config/legal";
import { openRoutes } from "@/config/navItems";
import type { User } from "@/models/Auth";

const auth = { user: null as User | null, ready: true };
vi.mock("next/router", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.user = null;
});

afterEach(cleanup);

const pages = [
  { name: "Contact", Page: Contact, title: "Contact us" },
  { name: "Terms", Page: Terms, title: "Terms & Conditions" },
  { name: "Privacy", Page: Privacy, title: "Privacy Policy" },
  { name: "RefundPolicy", Page: RefundPolicy, title: "Cancellation & Refund Policy" },
  { name: "ShippingPolicy", Page: ShippingPolicy, title: "Shipping & Delivery Policy" },
];

describe("legal pages", () => {
  it.each(pages)("$name shows its title and the date it was last updated", ({ Page, title }) => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByText(`Last updated: ${legal.lastUpdated}`)).toBeTruthy();
  });

  it("are open to logged-out visitors, so reviewers can read them without an account", () => {
    for (const { href } of legalLinks) expect(openRoutes).toContain(href);
  });

  it("show the public footer with every policy to logged-out visitors", () => {
    render(<Terms />);
    const footer = within(screen.getByRole("navigation", { name: "Legal" }));
    for (const { href, label } of legalLinks) {
      expect(footer.getByRole("link", { name: label }).getAttribute("href")).toBe(href);
    }
  });

  it("render inside the app, without the public top bar, for logged-in users", () => {
    auth.user = { id: 1, username: "u", email: "u@example.com", first_name: "U" } as User;
    render(<RefundPolicy />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cancellation & Refund Policy");
    expect(screen.queryByRole("navigation", { name: "Legal" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  });

  it("Contact lists the business, email, phone and address", () => {
    render(<Contact />);
    expect(screen.getAllByRole("link", { name: legal.email })[0].getAttribute("href")).toBe(`mailto:${legal.email}`);
    expect(screen.getByRole("link", { name: legal.phone }).getAttribute("href")).toBe(legal.phoneHref);
    expect(screen.getByText(legal.address)).toBeTruthy();
    expect(screen.getAllByText(legal.operator).length).toBeGreaterThan(0);
  });

  it("the refund policy states the money-back window and grace period the server uses", () => {
    render(<RefundPolicy />);
    expect(screen.getByRole("heading", { name: `3. ${legal.refundDays}-day money-back guarantee` })).toBeTruthy();
    expect(screen.getByText(/once per account/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`keep your plan for ${legal.graceDays} days`))).toBeTruthy();
  });

  it("the terms set the minimum age and governing courts", () => {
    render(<Terms />);
    expect(screen.getByText(`You must be at least ${legal.minimumAge} years old.`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`courts\\s+in ${legal.jurisdiction}`))).toBeTruthy();
  });
});
