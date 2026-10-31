// Shared by client and server. Profile names and item names arrive in QR links, so they are
// untrusted text: keep them short and plain before they are shown or given to the model.

export const NAME_MAX = 20;
export const ITEM_NAME_MAX = 60;

/** Letters (any script), spaces and - ' . only, at most 20 characters. */
export function cleanName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{M} '.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** One line of printable text: no control characters, brackets or markup, at most 60 characters. */
export function cleanItemName(raw: string): string {
  return raw
    .normalize("NFC")
    // Control and format characters go, except the zero-width joiner inside emoji sequences.
    .replace(/(?!\u200d)[\p{C}]/gu, " ")
    .replace(/[<>{}\[\]`\\|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ITEM_NAME_MAX)
    .trim();
}
