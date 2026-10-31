/**
 * Turns a DRF error body like {"role": ["This field is required."]} into one readable line.
 * A body with a `detail` message (e.g. a 429 that also carries the limit and reset time) is just that message.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (Array.isArray(err)) return err.map(errorText).join(" ");
  if (err && typeof err === "object") {
    const { detail } = err as { detail?: unknown };
    if (typeof detail === "string") return detail;
    return Object.entries(err as Record<string, unknown>)
      .map(([key, value]) => {
        const text = errorText(value);
        if (key === "detail" || key === "non_field_errors") return text;
        return `${key.replace(/_/g, " ")}: ${text}`;
      })
      .join(" ");
  }
  return "";
}
