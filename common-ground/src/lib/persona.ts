import { useMemo, useSyncExternalStore } from "react";
import type { Persona, PersonaUpdate } from "./contracts";
import { cleanItemName, cleanName } from "./sanitize";
import { type Domain, type Profile, type TasteItem, DOMAIN_KEYS } from "./types";

// Larry's picture of someone's taste. It lives only in this browser (localStorage): no account,
// no server copy. Chat requests send it along so Larry can use it, and Larry's PersonaUpdate comes
// back to be merged here, where the person can see, change or remove every part of it (/me).

const PERSONA_KEY = "larry.persona";
/** The old saved taste card. Read once to migrate, and kept in step as a mirror of the top picks. */
const LEGACY_PROFILE_KEY = "cg.profile";

/** Notes Larry keeps, newest first. */
export const NOTES_MAX = 20;
/** Same as the server's NOTE_MAX (schemas.ts). */
const NOTE_CHARS = 100;
const DISLIKES_MAX = 60;
/** No pick limit in the app; this only stops a broken update from filling the browser's storage. */
const LIKES_STORE_MAX = 400;
/** Likes a chat request may carry (schemas.ts accepts 300); the newest go. */
export const REQUEST_LIKES_MAX = 300;
/** How many top picks the QR card and pair/room requests carry. */
export const CARD_TOP = 10;

const VIBES = ["calm", "cosy", "lively"] as const;

/* ---------- Pure helpers (shared with tests and the server-free UI) ---------- */

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const isDomain = (d: unknown): d is Domain => typeof d === "string" && (DOMAIN_KEYS as string[]).includes(d);
const isVibe = (v: unknown): v is NonNullable<Persona["placeVibe"]> => typeof v === "string" && (VIBES as readonly string[]).includes(v);

function cleanNote(raw: string): string {
  const s = cleanItemName(String(raw ?? "").slice(0, 400));
  if (s.length <= NOTE_CHARS) return s;
  const cut = s.slice(0, NOTE_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > NOTE_CHARS / 2 ? cut.slice(0, space) : cut).trim();
}

function cleanItem(raw: unknown): TasteItem | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Partial<TasteItem>;
  if (typeof it.id !== "string" || !it.id || it.id.length > 64 || !isDomain(it.domain)) return null;
  const name = cleanItemName(typeof it.name === "string" ? it.name : "");
  if (!name) return null;
  const image = typeof it.image === "string" && it.image.startsWith("https://") && it.image.length <= 300 ? it.image : undefined;
  return { id: it.id, name, domain: it.domain, ...(image ? { image } : {}) };
}

function cleanDislike(raw: unknown): Persona["dislikes"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Persona["dislikes"][number];
  const name = cleanItemName(typeof d.name === "string" ? d.name : "");
  if (!name) return null;
  return {
    name,
    ...(typeof d.id === "string" && d.id && d.id.length <= 64 ? { id: d.id } : {}),
    ...(isDomain(d.domain) ? { domain: d.domain } : {}),
  };
}

const sameDislike = (a: Persona["dislikes"][number], b: { id?: string; name: string }) =>
  (!!a.id && a.id === b.id) || norm(a.name) === norm(b.name);

const likeMatchesDislike = (like: TasteItem, d: Persona["dislikes"][number]) =>
  (!!d.id && d.id === like.id) || norm(d.name) === norm(like.name);

/** A fresh, empty persona. */
export function emptyPersona(name = ""): Persona {
  return { version: 1, name: cleanName(name), likes: [], dislikes: [], notes: [], updatedAt: Date.now() };
}

/** Checks and cleans a persona from storage or a request. Returns null when it isn't one. */
export function parsePersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Persona>;
  if (p.version !== 1 || !Array.isArray(p.likes)) return null;
  const likes: TasteItem[] = [];
  for (const it of p.likes) {
    const item = cleanItem(it);
    if (item && !likes.some((l) => l.id === item.id)) likes.push(item);
  }
  const dislikes: Persona["dislikes"] = [];
  for (const d of Array.isArray(p.dislikes) ? p.dislikes : []) {
    const clean = cleanDislike(d);
    if (clean && !dislikes.some((x) => sameDislike(x, clean))) dislikes.push(clean);
  }
  const notes: string[] = [];
  for (const n of Array.isArray(p.notes) ? p.notes : []) {
    const clean = typeof n === "string" ? cleanNote(n) : "";
    if (clean && !notes.some((x) => norm(x) === norm(clean))) notes.push(clean);
  }
  return {
    version: 1,
    name: cleanName(typeof p.name === "string" ? p.name : ""),
    likes: likes.slice(0, LIKES_STORE_MAX),
    dislikes: dislikes.slice(0, DISLIKES_MAX),
    notes: notes.slice(0, NOTES_MAX),
    ...(isVibe(p.placeVibe) ? { placeVibe: p.placeVibe } : {}),
    updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
  };
}

/**
 * Merges what Larry learned into a persona. New or confirmed likes move to the front (newest and
 * most-confirmed first); a new dislike takes the same thing off the likes, and a new like takes it
 * off the dislikes. Notes go on top, without repeats, at most NOTES_MAX.
 */
export function applyPersonaUpdate(p: Persona, u: PersonaUpdate): Persona {
  let likes = [...p.likes];
  let dislikes = [...p.dislikes];
  let notes = [...p.notes];

  // Reversed so the first item of the update ends up first.
  for (const raw of [...(u.addLikes ?? [])].reverse()) {
    const item = cleanItem(raw);
    if (!item) continue;
    const existing = likes.find((l) => l.id === item.id);
    likes = [{ ...existing, ...item, image: item.image ?? existing?.image }, ...likes.filter((l) => l.id !== item.id)];
    dislikes = dislikes.filter((d) => !likeMatchesDislike(item, d));
  }
  for (const raw of u.addDislikes ?? []) {
    const d = cleanDislike(raw);
    if (!d) continue;
    if (!dislikes.some((x) => sameDislike(x, d))) dislikes = [d, ...dislikes];
    likes = likes.filter((l) => !likeMatchesDislike(l, d));
  }
  for (const raw of [...(u.addNotes ?? [])].reverse()) {
    const n = cleanNote(raw);
    if (!n) continue;
    notes = [n, ...notes.filter((x) => norm(x) !== norm(n))];
  }

  return {
    ...p,
    likes: likes.slice(0, LIKES_STORE_MAX),
    dislikes: dislikes.slice(0, DISLIKES_MAX),
    notes: notes.slice(0, NOTES_MAX),
    ...(isVibe(u.placeVibe) ? { placeVibe: u.placeVibe } : {}),
    updatedAt: Date.now(),
  };
}

/**
 * Takes back one update ("Undo" under "Larry learned: ..."), leaving anything learned since in place.
 * `before` is the persona as it was just before the update was applied.
 */
export function undoPersonaUpdate(p: Persona, u: PersonaUpdate, before: Persona): Persona {
  const addedLikeIds = new Set((u.addLikes ?? []).map((i) => i.id).filter((id) => !before.likes.some((l) => l.id === id)));
  const addedDislikes = (u.addDislikes ?? []).filter((d) => !before.dislikes.some((x) => sameDislike(x, d)));
  const addedNotes = new Set((u.addNotes ?? []).map((n) => norm(cleanNote(n))).filter((n) => !before.notes.some((x) => norm(x) === n)));

  let likes = p.likes.filter((l) => !addedLikeIds.has(l.id));
  // Likes the update's dislikes took off come back, in their old place.
  const removedByDislike = before.likes.filter((l) => !likes.some((x) => x.id === l.id) && (u.addDislikes ?? []).some((d) => likeMatchesDislike(l, d)));
  if (removedByDislike.length) {
    const order = new Map(before.likes.map((l, i) => [l.id, i]));
    likes = [...likes, ...removedByDislike].sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
  }
  // Dislikes the update's likes took off come back too.
  const restoredDislikes = before.dislikes.filter(
    (d) => !p.dislikes.some((x) => sameDislike(x, d)) && (u.addLikes ?? []).some((l) => likeMatchesDislike(l, d)),
  );

  return {
    ...p,
    likes,
    dislikes: [...p.dislikes.filter((d) => !addedDislikes.some((a) => sameDislike(d, a))), ...restoredDislikes],
    notes: p.notes.filter((n) => !addedNotes.has(norm(n))),
    placeVibe: u.placeVibe && p.placeVibe === u.placeVibe ? before.placeVibe : p.placeVibe,
    updatedAt: Date.now(),
  };
}

/** True when an update would change nothing a person could see. */
export function isEmptyUpdate(u: PersonaUpdate | null | undefined): boolean {
  return !u || (!u.addLikes?.length && !u.addDislikes?.length && !u.addNotes?.length && !u.placeVibe);
}

const VIBE_WORDS: Record<NonNullable<Persona["placeVibe"]>, string> = {
  calm: "calm, quiet places",
  cosy: "cosy places",
  lively: "lively, busy places",
};

export const vibeWords = (v: NonNullable<Persona["placeVibe"]>) => VIBE_WORDS[v];

/** Easy-read lines for "Larry learned: ...", one short sentence each. */
export function describePersonaUpdate(u: PersonaUpdate): string[] {
  const lines: string[] = [];
  const likes = (u.addLikes ?? []).map((i) => i.name).filter(Boolean);
  const dislikes = (u.addDislikes ?? []).map((d) => d.name).filter(Boolean);
  if (likes.length) lines.push(`You like ${listWords(likes)}.`);
  if (dislikes.length) lines.push(`You don't enjoy ${listWords(dislikes)}.`);
  if (u.placeVibe) lines.push(`You like ${VIBE_WORDS[u.placeVibe]}.`);
  for (const n of u.addNotes ?? []) {
    const note = cleanNote(n);
    if (!note) continue;
    const sentence = note.charAt(0).toUpperCase() + note.slice(1);
    lines.push(/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
  }
  return lines;
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The top picks, for the QR card and pair/room requests: newest and most-confirmed first. */
export function personaToProfile(p: Persona, max = CARD_TOP): Profile {
  return { name: p.name, items: p.likes.slice(0, Math.max(0, max)) };
}

/** The persona as a chat request carries it: everything, except likes beyond the newest 300. */
export function personaForRequest(p: Persona): Persona {
  return p.likes.length > REQUEST_LIKES_MAX ? { ...p, likes: p.likes.slice(0, REQUEST_LIKES_MAX) } : p;
}

/** Migration from the old saved taste card. */
export function personaFromProfile(profile: Profile): Persona {
  return (
    parsePersona({
      version: 1,
      name: profile.name,
      likes: profile.items ?? [],
      dislikes: [],
      notes: [],
      updatedAt: Date.now(),
    }) ?? emptyPersona(profile.name)
  );
}

/* ---------- Device storage ---------- */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const hasStorage = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function legacyProfile(): Profile | null {
  const raw = readJson(LEGACY_PROFILE_KEY) as Profile | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  return { name: typeof raw.name === "string" ? raw.name : "", items: raw.items };
}

/** Saves the old taste card as a persona the first time a newer version of the app runs. */
function migrate(): Persona | null {
  if (!hasStorage() || localStorage.getItem(PERSONA_KEY)) return null;
  const old = legacyProfile();
  if (!old || old.items.length === 0) return null;
  const persona = personaFromProfile(old);
  try {
    localStorage.setItem(PERSONA_KEY, JSON.stringify(persona));
  } catch {
    // Storage full or blocked: it still works for this visit.
  }
  return persona;
}

/** The saved persona, or null when there is none yet (or on the server). */
export function loadPersona(): Persona | null {
  if (!hasStorage()) return null;
  const stored = parsePersona(readJson(PERSONA_KEY));
  if (stored) return stored;
  return migrate();
}

/** Saves the persona on this device only. The old card key keeps the top picks for older code. */
export function savePersona(p: Persona): void {
  if (!hasStorage()) return;
  const clean = parsePersona({ ...p, updatedAt: p.updatedAt || Date.now() }) ?? emptyPersona(p.name);
  try {
    localStorage.setItem(PERSONA_KEY, JSON.stringify(clean));
    localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(personaToProfile(clean)));
  } catch {
    // Storage full or blocked: nothing else to do on the device.
  }
  emit();
}

/** Forgets the persona and the old card on this device. */
export function clearPersona(): void {
  if (!hasStorage()) return;
  localStorage.removeItem(PERSONA_KEY);
  localStorage.removeItem(LEGACY_PROFILE_KEY);
  emit();
}

export function subscribePersona(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PERSONA_KEY || e.key === LEGACY_PROFILE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  // First load in a browser: move an old saved card over (runs after render, never during it).
  if (migrate()) queueMicrotask(emit);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** Raw snapshot: the stored persona, or the old card while it hasn't been migrated yet. */
function snapshot(): string {
  return localStorage.getItem(PERSONA_KEY) ?? `legacy:${localStorage.getItem(LEGACY_PROFILE_KEY) ?? ""}`;
}

/** The persona a raw snapshot stands for. */
function personaFromSnapshot(raw: string): Persona | null {
  try {
    if (!raw.startsWith("legacy:")) return parsePersona(JSON.parse(raw));
    const rest = raw.slice("legacy:".length);
    if (!rest) return null;
    const old = JSON.parse(rest) as Profile;
    return Array.isArray(old?.items) && old.items.length ? personaFromProfile(old) : null;
  } catch {
    return null;
  }
}

/** The saved persona; null when there is none; undefined while rendering on the server. */
export function usePersona(): Persona | null | undefined {
  const raw = useSyncExternalStore(subscribePersona, snapshot, () => undefined);
  return useMemo(() => (raw === undefined ? undefined : personaFromSnapshot(raw)), [raw]);
}
