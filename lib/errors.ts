/**
 * Supabase/PostgREST errors are plain objects, not Error instances, so
 * `String(e)` on them yields "[object Object]". Pull out whatever the most
 * useful human-readable field is.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint].filter(
      (v): v is string => typeof v === "string" && v.length > 0
    );
    if (parts.length) {
      return o.code ? `${parts[0]} (${String(o.code)})` : parts.join(" — ");
    }
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}
