import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { cleanItemName, cleanName } from "./sanitize";
import { type Profile, type TasteItem, DOMAIN_KEYS } from "./types";

// A taste card travels inside the QR link itself, so there is no database to run.
//
// v3 is a small binary format, base64url-encoded. It carries the top 10 picks and still fits a QR
// code of version 18 or lower at error correction "L" (at most CODE_MAX characters for the code):
//   byte 0      version (3)
//   name        length byte + UTF-8 (at most 20 characters / 30 bytes)
//   per item    flags byte: bits 0-3 domain index (16 slots, 11 used), bit 4 id is a UUID
//               (16 raw bytes), bit 5 custom image file name follows, bit 6 no image
//               id: 16 bytes, or length byte + UTF-8
//               name: length byte + UTF-8 (at most 34 bytes, cut at a word; shorter when the
//               card would not fit otherwise)
//               custom image: length byte + UTF-8 file name
// Images are rebuilt from the id (Qloo's usual URL), so they cost nothing in the common case.
// Older codes still decode: v2 (the same layout with 3 domain bits, up to 6 items) and v1
// (base64url JSON, starting with "ey"). DOMAIN_KEYS only ever grows at the end, so old indexes hold.

const IMAGE_BASE = "https://images.qloo.com/i/";
/** Picks the QR card carries (the persona keeps the rest on the phone). */
const MAX_ITEMS = 10;
const V2_MAX_ITEMS = 6;
const VERSION = 3;
const NAME_BYTES = 30;
/** Item name budgets tried in turn until the code fits. */
const ITEM_NAME_STEPS = [34, 28, 22, 16] as const;
/** About 718 bytes fit version 18 at level L; this leaves room for a link prefix of up to ~75 characters. */
export const CODE_MAX = 640;

// v3 flags
const F_UUID = 1 << 4;
const F_CUSTOM_IMAGE = 1 << 5;
const F_NO_IMAGE = 1 << 6;
const DOMAIN_MASK = 0x0f;
// v2 flags
const V2 = { uuid: 1 << 3, customImage: 1 << 4, noImage: 1 << 5, domainMask: 0x07 } as const;
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const ID_RE = /^[\w.:-]{1,64}$/;
const FILE_RE = /^[\w.-]{1,120}$/;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

const defaultImage = (id: string) => `${IMAGE_BASE}${id}-420x-auto.jpg`;

/** UTF-8 bytes of `s`, at most `max`, cut at a word (or character) boundary. */
function fitBytes(s: string, max: number): Uint8Array {
  const full = enc.encode(s);
  if (full.length <= max) return full;
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  // "The Legend of Zelda: Breath of the Wild" reads better as "The Legend of Zelda".
  const colon = out.indexOf(":");
  if (colon >= 6) out = out.slice(0, colon);
  else {
    const cut = out.lastIndexOf(" ");
    if (cut >= max / 2) out = out.slice(0, cut);
  }
  // Don't end on a dangling small word ("Harry Potter and the").
  let prev;
  do {
    prev = out;
    out = out.replace(/[\s:,;&-]+$/, "").replace(/\s+(the|of|and|a|an|to|in|on|for|with)$/i, "");
  } while (out !== prev);
  return enc.encode(out);
}

export function encodeProfile(p: Profile): string {
  const items = p.items.slice(0, MAX_ITEMS);
  // Shorter names first, then fewer picks, until the code fits a QR code of version 18.
  for (let count = items.length; count >= 0; count--) {
    for (const nameBytes of ITEM_NAME_STEPS) {
      const code = encodeWith(p.name, items.slice(0, count), nameBytes);
      if (code.length <= CODE_MAX || (count === 0 && nameBytes === ITEM_NAME_STEPS.at(-1))) return code;
    }
  }
  return encodeWith(p.name, [], ITEM_NAME_STEPS.at(-1)!);
}

function encodeWith(rawName: string, items: TasteItem[], itemNameBytes: number): string {
  const out: number[] = [VERSION];
  const pushStr = (bytes: Uint8Array) => out.push(Math.min(bytes.length, 255), ...bytes.slice(0, 255));

  pushStr(fitBytes(cleanName(rawName) || "Friend", NAME_BYTES));

  for (const it of items) {
    const d = DOMAIN_KEYS.indexOf(it.domain);
    const name = cleanItemName(it.name);
    if (d < 0 || d > DOMAIN_MASK || !name || !it.id) continue;
    const isUuid = UUID_RE.test(it.id);
    let flags = d;
    let customImage: string | undefined;
    if (isUuid) flags |= F_UUID;
    if (!it.image) flags |= F_NO_IMAGE;
    else if (it.image !== defaultImage(it.id)) {
      const file = it.image.startsWith(IMAGE_BASE) ? it.image.slice(IMAGE_BASE.length) : "";
      if (FILE_RE.test(file)) {
        flags |= F_CUSTOM_IMAGE;
        customImage = file;
      } else flags |= F_NO_IMAGE;
    }
    out.push(flags);
    if (isUuid) {
      const hex = it.id.replace(/-/g, "");
      for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    } else pushStr(enc.encode(it.id.slice(0, 64)));
    pushStr(fitBytes(name, itemNameBytes));
    if (customImage) pushStr(enc.encode(customImage));
  }
  return bytesToBase64Url(Uint8Array.from(out));
}

export function decodeProfile(code: string): Profile | null {
  try {
    if (code.startsWith("ey")) return decodeV1(code);
    const bytes = base64UrlToBytes(code);
    if (bytes[0] === VERSION) return decodeBinary(bytes, { uuid: F_UUID, customImage: F_CUSTOM_IMAGE, noImage: F_NO_IMAGE, domainMask: DOMAIN_MASK }, MAX_ITEMS);
    if (bytes[0] === 2) return decodeBinary(bytes, V2, V2_MAX_ITEMS);
    return null;
  } catch {
    return null;
  }
}

type Flags = { uuid: number; customImage: number; noImage: number; domainMask: number };

/** v2 and v3 share one layout; only the flag bits and the item count differ. */
function decodeBinary(bytes: Uint8Array, f: Flags, maxItems: number): Profile | null {
  let pos = 1;
  const readStr = () => {
    const len = bytes[pos++];
    if (len === undefined || pos + len > bytes.length) throw new Error("truncated");
    const s = dec.decode(bytes.slice(pos, pos + len));
    pos += len;
    return s;
  };
  const name = cleanName(readStr()) || "Friend";
  const items: TasteItem[] = [];
  while (pos < bytes.length && items.length < maxItems) {
    const flags = bytes[pos++];
    const domain = DOMAIN_KEYS[flags & f.domainMask];
    let id: string;
    if (flags & f.uuid) {
      if (pos + 16 > bytes.length) throw new Error("truncated");
      const hex = Array.from(bytes.slice(pos, pos + 16), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      pos += 16;
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } else id = readStr();
    const itemName = cleanItemName(readStr());
    const file = flags & f.customImage ? readStr() : undefined;
    if (!domain || !ID_RE.test(id) || !itemName) continue;
    const image =
      flags & f.noImage ? undefined : file !== undefined ? (FILE_RE.test(file) ? IMAGE_BASE + file : undefined) : defaultImage(id);
    items.push({ id, name: itemName, domain, image });
  }
  return { name, items };
}

type PackedV1 = { n: string; i: [string, string, number, string?][] };

function decodeV1(code: string): Profile | null {
  const packed = JSON.parse(dec.decode(base64UrlToBytes(code))) as PackedV1;
  if (typeof packed.n !== "string" || !Array.isArray(packed.i)) return null;
  const items: TasteItem[] = [];
  for (const row of packed.i) {
    if (!Array.isArray(row) || items.length >= V2_MAX_ITEMS) continue;
    const [id, rawName, d, img] = row;
    if (typeof id !== "string" || !ID_RE.test(id) || typeof rawName !== "string" || typeof d !== "number") continue;
    const domain = DOMAIN_KEYS[d];
    const itemName = cleanItemName(rawName);
    if (!domain || !itemName) continue;
    items.push({ id, name: itemName, domain, image: typeof img === "string" && FILE_RE.test(img) ? IMAGE_BASE + img : undefined });
  }
  return { name: cleanName(packed.n) || "Friend", items };
}

export { MAX_ITEMS };
