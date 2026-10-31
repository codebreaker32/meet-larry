/** A safe in-app path from ?next=, else `fallback`. Never another site (no open redirects). */
export function safeNext(raw: string | null | undefined, fallback = "/me"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  if (raw.startsWith("/signin") || raw.startsWith("/signup")) return fallback;
  return raw.slice(0, 200);
}
