/** Turns a DRF error body like {"role": ["This field is required."]} into one readable line. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (Array.isArray(err)) return err.map(errorText).join(" ");
  if (err && typeof err === "object") {
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
