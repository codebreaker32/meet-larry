"use client";

import { useMemo, useSyncExternalStore } from "react";
import { emptyPersona, loadPersona, personaToProfile, savePersona, usePersona } from "./persona";
import type { FirstStep, Profile } from "./types";

// Everything personal stays on the device first; accounts sync only what types/account.ts allows.
// The taste card is now the top of Larry's persona (src/lib/persona.ts); useProfile and
// saveProfile stay for the screens that only need a card.

const STEPS_KEY = "cg.steps";

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  listeners.forEach((l) => l());
}

/**
 * Saves one small value on the device (JSON). null removes it. Returns false when storage refuses
 * (private browsing, a full phone), so the caller can say "that didn't save" instead of pretending.
 */
export function writeStored(key: string, value: unknown): boolean {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

/** Reads one stored value outside React (request bodies); the fallback when missing or unreadable. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    return parse<T>(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Raw stored string; `undefined` while rendering on the server (not loaded yet). */
function useRaw(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => undefined,
  );
}

/** One stored value, live across tabs; `undefined` while rendering on the server. */
export function useStored<T>(key: string, fallback: T): T | undefined {
  const raw = useRaw(key);
  // The fallback is a constant at every call site, so it is left out of the deps on purpose.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw === undefined ? undefined : parse<T>(raw, fallback)), [raw]);
}

/** The taste card: the persona's top picks (at most 10). null with no card yet; undefined on the server. */
export function useProfile(): Profile | null | undefined {
  const persona = usePersona();
  return useMemo(() => {
    if (persona === undefined) return undefined;
    if (!persona || persona.likes.length === 0) return null;
    return personaToProfile(persona);
  }, [persona]);
}

export function useSteps(): FirstStep[] | undefined {
  const raw = useRaw(STEPS_KEY);
  return useMemo(() => (raw === undefined ? undefined : parse<FirstStep[]>(raw, [])), [raw]);
}

/**
 * Saves a card made outside /create (a room's quick card, an older screen): its picks go to the top
 * of the persona, and everything Larry learned before stays.
 */
export function saveProfile(p: Profile) {
  const current = loadPersona() ?? emptyPersona(p.name);
  const ids = new Set(p.items.map((i) => i.id));
  savePersona({
    ...current,
    name: p.name || current.name,
    likes: [...p.items, ...current.likes.filter((l) => !ids.has(l.id))],
    updatedAt: Date.now(),
  });
}
export const saveSteps = (steps: FirstStep[]) => write(STEPS_KEY, steps);

type NewStep = Omit<FirstStep, "id" | "createdAt" | "done">;

const norm = (t: string | undefined) => (t ?? "").trim().toLowerCase();

/** The same step, still to do: same kind, same words, same person. */
export function isSameOpenStep(existing: FirstStep, s: NewStep): boolean {
  // Two open plans for the same real place are one plan, whatever time or wording each has.
  const placeOf = (x: object) => ("placeId" in x && typeof x.placeId === "string" ? x.placeId : undefined);
  const place = placeOf(existing);
  if (!existing.done && place && existing.kind === "go" && s.kind === "go" && place === placeOf(s)) return true;
  return (
    !existing.done &&
    existing.kind === s.kind &&
    norm(existing.text) === norm(s.text) &&
    norm(existing.withPerson) === norm(s.withPerson)
  );
}

/**
 * Saves new First Steps at the top of the list. A step that is already on the list and not done
 * yet is skipped, so opening a shared step link twice doesn't save it twice. Returns how many were added.
 */
export function addSteps(newSteps: NewStep[]): number {
  const steps = parse<FirstStep[]>(localStorage.getItem(STEPS_KEY), []);
  let added = 0;
  for (const s of newSteps) {
    if (steps.some((e) => isSameOpenStep(e, s))) continue;
    steps.unshift({ ...s, id: crypto.randomUUID(), createdAt: Date.now(), done: false });
    added++;
  }
  if (added) saveSteps(steps);
  return added;
}

/** How many real-world First Steps are done on this device: drives the fade (see practiceTurnsFor). */
export function useStepsDone(): number | undefined {
  const steps = useSteps();
  return steps === undefined ? undefined : steps.filter((s) => s.done).length;
}

const noopSubscribe = () => () => {};

/** This site's origin in the browser, "" on the server. */
export function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

/** Whether a browser feature exists; false on the server. */
export function useBrowserSupport(check: () => boolean): boolean {
  return useSyncExternalStore(noopSubscribe, check, () => false);
}
