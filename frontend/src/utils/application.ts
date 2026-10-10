import type { Application } from "@/models/Application";
import { formatDate } from "./format";

/**
 * Applying to a saved job without picking a date dates it today (the server does this). Returns a
 * notice saying so, or null when nothing like that happened.
 */
export function appliedTodayNotice(before: Application, after: Application): string | null {
  if (before.applied_at || !after.applied_at || after.date_applied === before.date_applied) return null;
  return `Applied date set to today, ${formatDate(after.date_applied)}. Edit the application if you applied earlier.`;
}
