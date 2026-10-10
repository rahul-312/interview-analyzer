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
 * Moving a job in or out of Saved can change its date on the server (see Application.save). Returns a
 * notice saying how, or null when the date is what was sent. `sentDate` is the date the edit sent:
 * the form's date, or the old one when only the status was changed.
 */
export function dateChangeNotice(before: Application, after: Application, sentDate = before.date_applied): string | null {
  if (after.date_applied === sentDate) return null;
  const date = formatDate(after.date_applied);
  if (after.status === "saved") return `Its date is now ${date}, the date it was saved.`;
  if (before.applied_at || !after.applied_at) return null;
  if (after.date_applied === today()) {
    return `Applied date set to today, ${date}. Edit the application if you applied earlier.`;
  }
  return `Applied date restored to ${date}, from before it was set to Saved. Edit the application if that's wrong.`;
}
