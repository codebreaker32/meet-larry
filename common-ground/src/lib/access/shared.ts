// Access-code names shared by the server (requireCode) and the browser (apiFetch, the code form).
// Keep this file free of server-only and browser-only imports.

/** Request header that carries the person's access code. */
export const CODE_HEADER = "x-larry-code";
/** Response header on a 401/402 from an AI route: why the code didn't work. */
export const ACCESS_HEADER = "x-larry-access";

/** Why an AI route turned a request away. */
export type AccessState = "missing" | "invalid" | "spent";

/** Easy-read messages, shown in the app as they are. */
export const ACCESS_TEXT: Record<AccessState, string> = {
  missing: "Sign in to get your own Larry time. Or type an access code once on this phone.",
  invalid: "That code didn't work. Check it and try again.",
  spent: "That's your Larry time for now! Everything else (your card, places, plans) still works.",
};

/** Codes look like LARRY-7K2P-Q9XM: no 0/O or 1/I, so a code read off paper can't be typed wrong. */
export const ACCESS_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** Random characters after "LARRY-", shown as two groups of 4. 32^8 is about a trillion. */
export const ACCESS_CODE_CHARS = 8;
export const ACCESS_CODE_EXAMPLE = "LARRY-XXXX-XXXX";

const BODY_RE = new RegExp(`^[${ACCESS_CODE_ALPHABET}]{${ACCESS_CODE_CHARS}}$`);

/**
 * The canonical code ("LARRY-7K2P-Q9XM") from anything a person might type: lower case, spaces,
 * missing dashes, with or without "LARRY". Null when it can't be an access code.
 */
export function normalizeAccessCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 60) return null;
  let s = raw.toUpperCase().replace(/[\s_\-–—.]+/g, "");
  if (s.startsWith("LARRY")) s = s.slice(5);
  if (!BODY_RE.test(s)) return null;
  return `LARRY-${s.slice(0, 4)}-${s.slice(4)}`;
}
