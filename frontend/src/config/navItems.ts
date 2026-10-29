import { BookOpen, BriefcaseBusiness, CalendarDays, ChartNoAxesColumn } from "lucide-react";
import type { NavItem } from "@/models/Common";

export const navItems: NavItem[] = [
  { label: "Applications", href: "/applications", icon: BriefcaseBusiness },
  { label: "Interviews", href: "/interviews", icon: CalendarDays },
  { label: "Analysis", href: "/analysis", icon: ChartNoAxesColumn },
  { label: "Prep", href: "/prep", icon: BookOpen },
];

/** Routes that render without the navbar and don't need a login. */
export const publicRoutes = ["/login", "/register"];
