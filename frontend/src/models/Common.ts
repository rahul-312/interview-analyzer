import type { LucideIcon } from "lucide-react";

export type JobStatus = "pending" | "running" | "done" | "failed";

export type GeneratedBy = "" | "ai" | "rules";

export interface Option<T extends string> {
  value: T;
  label: string;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}
