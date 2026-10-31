// Podium aliases (pure, isomorphic, Web Crypto). Final: other code builds on these exact outputs.
//
//   podiumKey = HMAC-SHA256(deviceSecret, placeId + reroll)   the SECRET the device sends on leave
//   podiumId  = SHA-256(podiumKey)                             what the server stores
//   alias     = aliasName(podiumId)                            the public name, e.g. "QuietOtter42"
//
// The public name is a one-way function of a secret, so knowing someone's alias never lets anyone
// move or add to their count. A different place or a re-roll gives an unrelated name, so one
// person's podium names can't be joined across places. The device secret never leaves the device
// (STORAGE_KEYS.deviceSecret).
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";

/** A podium key or id: 64 lowercase hex characters. Validate request bodies with this. */
export const PODIUM_HEX_RE = /^[0-9a-f]{64}$/;
/** An alias: Adjective + Noun + 2 to 99, e.g. "QuietOtter42" (no "u/" prefix: Larry is not Reddit). */
export const ALIAS_RE = /^[A-Z][a-z]+[A-Z][a-z]+[1-9][0-9]?$/;

const DEVICE_SECRET_BYTES = 32;

/**
 * Words chosen to never read as a person's real name (no Rose, Sky, Robin, Sunny, Olive, Jay and
 * the like) and to stay kind in every combination.
 */
export const ALIAS_ADJECTIVES = [
  "Quiet", "Mossy", "Brave", "Calm", "Cosy", "Bright", "Clever", "Curious",
  "Dusty", "Eager", "Fuzzy", "Gentle", "Golden", "Happy", "Humble", "Jolly",
  "Kind", "Spry", "Mellow", "Leafy", "Nimble", "Plucky", "Proud", "Rapid",
  "Rusty", "Shy", "Silver", "Sleepy", "Snowy", "Swift", "Tidy", "Tiny",
  "Witty", "Zesty", "Bold", "Breezy", "Chirpy", "Cheery", "Crisp", "Dapper",
  "Fancy", "Frosty", "Giddy", "Glowing", "Grand", "Hazy", "Lofty", "Lunar",
  "Merry", "Nifty", "Patient", "Peppy", "Polite", "Quirky", "Snappy", "Steady",
  "Sturdy", "Velvet", "Woolly", "Zippy", "Cobalt", "Copper", "Minty", "Teal",
] as const;

export const ALIAS_NOUNS = [
  "Otter", "Lantern", "Badger", "Falcon", "Heron", "Koala", "Lemur", "Llama",
  "Marmot", "Narwhal", "Ocelot", "Panda", "Pelican", "Puffin", "Quokka", "Raccoon",
  "Sloth", "Squirrel", "Tapir", "Toucan", "Walrus", "Yak", "Beetle", "Bison",
  "Comet", "Cactus", "Dolphin", "Ferret", "Gecko", "Hedgehog", "Ibis", "Kiwi",
  "Lynx", "Mango", "Meteor", "Moth", "Newt", "Owl", "Parrot", "Pebble",
  "Pine", "Rocket", "Teapot", "Tortoise", "Turnip", "Waffle", "Acorn", "Biscuit",
  "Bramble", "Canoe", "Compass", "Dumpling", "Fern", "Kettle", "Kite", "Maple",
  "Noodle", "Pigeon", "Pretzel", "Radish", "Sparrow", "Thistle", "Walnut", "Zebra",
] as const;

const enc = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("Web Crypto is not available (needs HTTPS or localhost)");
  return s;
}

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A fresh device secret: 32 random bytes, base64url. Store it under STORAGE_KEYS.deviceSecret; never sync it. */
export function newDeviceSecret(): string {
  return bytesToBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(DEVICE_SECRET_BYTES)));
}

/** SHA-256 of UTF-8 text, as hex. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await subtle().digest("SHA-256", enc.encode(text)));
}

/**
 * The secret podium key for this device at this place (64 hex). `reroll` starts at 0; each
 * re-roll adds 1, which gives a new, unrelated alias.
 */
export async function podiumKey(deviceSecret: string, placeId: string, reroll = 0): Promise<string> {
  if (!deviceSecret) throw new Error("No device secret");
  if (!Number.isInteger(reroll) || reroll < 0) throw new Error("reroll must be a whole number from 0");
  const key = await subtle().importKey("raw", base64UrlToBytes(deviceSecret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await subtle().sign("HMAC", key, enc.encode(`podium\n${placeId}\n${reroll}`)));
}

/** What the server stores for a podium key: SHA-256 of the key's hex text. */
export async function podiumIdFor(key: string): Promise<string> {
  if (!PODIUM_HEX_RE.test(key)) throw new Error("Not a podium key");
  return sha256Hex(key);
}

/** The public alias for a podium id (or any 64-hex digest). Pure and synchronous. */
export function aliasName(podiumId: string): string {
  if (!PODIUM_HEX_RE.test(podiumId)) throw new Error("Not a podium id");
  const b = fromHex(podiumId);
  const adj = ALIAS_ADJECTIVES[((b[0] << 8) | b[1]) % ALIAS_ADJECTIVES.length];
  const noun = ALIAS_NOUNS[((b[2] << 8) | b[3]) % ALIAS_NOUNS.length];
  const n = 2 + (((b[4] << 8) | b[5]) % 98);
  return `${adj}${noun}${n}`;
}

/** The device's own alias at a place: what it looks for in the public podium list. */
export async function myAlias(deviceSecret: string, placeId: string, reroll = 0): Promise<string> {
  return aliasName(await podiumIdFor(await podiumKey(deviceSecret, placeId, reroll)));
}

/** A random name in the same style, e.g. for the account username generator. */
export function randomAlias(): string {
  return aliasName(toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))));
}

const ADJ_SET = new Set<string>(ALIAS_ADJECTIVES);
const NOUN_SET = new Set<string>(ALIAS_NOUNS);

/**
 * True for a name the generator could have made ("QuietOtter42"). Account usernames must pass
 * this, so nobody can sign up with a real name.
 */
export function isGeneratedName(name: string): boolean {
  const m = /^([A-Z][a-z]+)([A-Z][a-z]+)([1-9][0-9]?)$/.exec(name);
  return !!m && ADJ_SET.has(m[1]) && NOUN_SET.has(m[2]) && Number(m[3]) >= 2;
}
