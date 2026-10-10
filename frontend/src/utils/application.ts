import type { Application, AppStatus } from "@/models/Application";
import { formatDate, today } from "./format";

/** Moving a saved job to one of these means it was applied to (as the server decides). */
const APPLIED_STATUSES: AppStatus[] = ["applied", "screening", "interview", "offer"];

/**
 * Whether an application's date is its applied date (otherwise it's the date it was saved), going by
 * the status it's being given. Mirrors the server: added with any status but Saved means applied;
 * a saved job counts as applied once it moves to Applied, Screening, Interviewing or Offer.
 */
export function datesApplied(status: AppStatus, initial?: Application): boolean {
  if (status === "saved") return false;
  if (!initial || initial.applied_at) return true;
  return APPLIED_STATUSES.includes(status);
}

/**
 * Applying to a saved job without picking a date dates it today (the server does this). Returns a
 * notice saying so, or null when that didn't happen (including when an earlier applied date was
 * restored instead).
 */
export function appliedTodayNotice(before: Application, after: Application): string | null {
  if (before.applied_at || !after.applied_at) return null;
  if (after.date_applied === before.date_applied || after.date_applied !== today()) return null;
  return `Applied date set to today, ${formatDate(after.date_applied)}. Edit the application if you applied earlier.`;
}
