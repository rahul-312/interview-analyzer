/** "2026-10-09" or an ISO datetime → "9 Oct 2026". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** ISO datetime → value for an <input type="datetime-local">, in local time. */
export function toLocalInput(value: string | Date | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function today(): string {
  return toLocalInput(new Date()).slice(0, 10);
}

/** Whole days from today to the given date (negative if past). */
export function daysUntil(value: string): number {
  const target = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function inDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function isPast(value: string): boolean {
  return new Date(value).getTime() < Date.now();
}

/** "free" → "Free", "pro" → "Pro", "pro_plus" → "Pro Plus". */
export function planLabel(plan: string | null | undefined): string {
  if (plan === "pro_plus") return "Pro Plus";
  return plan === "pro" ? "Pro" : "Free";
}
