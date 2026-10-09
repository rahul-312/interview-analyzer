import type { NavItem } from "@/models/Common";

export const navItems: NavItem[] = [
  { label: "Applications", href: "/applications" },
  { label: "Interviews", href: "/interviews" },
  { label: "Analysis", href: "/analysis" },
  { label: "Prep", href: "/prep" },
];

/** Routes that render without the navbar and don't need a login. */
export const publicRoutes = ["/login", "/register"];
