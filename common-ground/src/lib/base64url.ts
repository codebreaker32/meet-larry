// Shared by client and server: base64url (RFC 4648 §5, no padding) for links and QR codes.

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on characters outside the base64url alphabet (atob rejects them). */
export function base64UrlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** UTF-8 text as base64url. */
export function textToBase64Url(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

/** base64url back to UTF-8 text. Invalid UTF-8 becomes U+FFFD rather than throwing. */
export function base64UrlToText(s: string): string {
  return new TextDecoder().decode(base64UrlToBytes(s));
}
