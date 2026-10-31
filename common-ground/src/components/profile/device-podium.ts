// This device's podium identity at one place (client only). The device secret never leaves the
// phone; only the derived per-place podium key does, and only on a re-roll or a "leave podiums".
// The device finds its own alias in the public podium list, so reading a podium never tells the
// server who is looking.
import { myAlias, newDeviceSecret, podiumKey } from "@/lib/alias";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

/** The raw secret, or null when the device has none yet (it has never counted a place). */
export function readDeviceSecret(): string | null {
  const raw = read(STORAGE_KEYS.deviceSecret);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === "string" && v ? v : null;
  } catch {
    return raw;
  }
}

/** The secret, made once if missing. Stored as plain text under STORAGE_KEYS.deviceSecret. */
export function ensureDeviceSecret(): string {
  const have = readDeviceSecret();
  if (have) return have;
  const s = newDeviceSecret();
  write(STORAGE_KEYS.deviceSecret, s);
  return s;
}

function rerolls(): Record<string, number> {
  try {
    const v = JSON.parse(read(STORAGE_KEYS.podiumRerolls) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const rerollCount = (placeId: string): number => Math.max(0, Math.floor(Number(rerolls()[placeId] ?? 0)) || 0);

export function saveRerollCount(placeId: string, n: number) {
  write(STORAGE_KEYS.podiumRerolls, JSON.stringify({ ...rerolls(), [placeId]: n }));
}

/** The current secret podium key at this place (what the verified leave sends). */
export async function devicePodiumKey(placeId: string): Promise<string> {
  return podiumKey(ensureDeviceSecret(), placeId, rerollCount(placeId));
}

/** This device's alias at a place, or null with no secret yet (then it can't be on the podium). */
export async function deviceAlias(placeId: string): Promise<string | null> {
  const s = readDeviceSecret();
  if (!s) return null;
  try {
    return await myAlias(s, placeId, rerollCount(placeId));
  } catch {
    return null;
  }
}

/** Keys for a re-roll: the current secret key and the next one. Saved only after the server agrees. */
export async function rerollKeys(placeId: string): Promise<{ oldKey: string; newKey: string; next: number }> {
  const s = ensureDeviceSecret();
  const n = rerollCount(placeId);
  return { oldKey: await podiumKey(s, placeId, n), newKey: await podiumKey(s, placeId, n + 1), next: n + 1 };
}
