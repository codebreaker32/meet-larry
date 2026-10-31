"use client";

import { useMemo, useSyncExternalStore } from "react";
import { isIsoWeek, isoWeek, weeksBetween } from "./iso-week";
import { stageFor, nextStage, titleWord, type Stage } from "./titles";
import type { IsoWeek, LeaveReason, PlaceCounter, SyncedPlaceCounter } from "./types/checkin";
import { STORAGE_KEYS } from "./types/storage-keys";

// Check-in v2 on the device (spec 7, D11, D16, D20). Two taps at a real Qloo place, each with one
// fresh location fix checked on the server and thrown away: Arrive ("I'm here") and Leave ("I'm
// heading off") 20+ minutes later. Only a verified visit counts for stages and Glory.
//
// What stays on this phone: one PlaceCounter per place (counts, a weeks bitset, the stage) and,
// between the two taps, the open visit (its server token and arrive time). The open visit is
// deleted on Leave, so no visit times are kept: "We keep counts, not a diary". Account sync sends
// SyncedPlaceCounter only (toSynced) and never runs from the Leave tap (1F debounces it).

export type { PlaceCounter, SyncedPlaceCounter };

/** An open visit with no Leave after this long becomes "Visited" (D16): no stage, no Glory. */
export const MISSED_LEAVE_MS = 12 * 60 * 60 * 1000;
/** The weeks bitset keeps this many weeks; older weeks drop off but spotWeeks never goes down. */
export const MAX_WEEKS_BITS = 104;
const MAX_PLACES = 300;

/* ---------- Folding visits into counters (pure) ---------- */

export function emptyCounter(placeId: string, placeName: string, week: IsoWeek): PlaceCounter {
  return { placeId, placeName: cleanPlaceName(placeName), visits: 0, weeksBits: "", totalWeeks: 0, lastIsoWeek: week, stage: null, spotWeeks: 0 };
}

const cleanPlaceName = (name: string) => name.replace(/[\p{C}<>]/gu, "").trim().slice(0, 120) || "this place";

/**
 * Spot weeks and rest weeks, one pure function: marks `week` as visited. A missed week adds a "0"
 * (a rest week) and pauses the count; nothing ever resets it. A week already marked changes nothing.
 * A week older than lastIsoWeek (a phone clock that went back) is ignored.
 */
export function foldWeek(c: PlaceCounter, week: IsoWeek): PlaceCounter {
  if (!isIsoWeek(week)) return c;
  if (!c.weeksBits) {
    return { ...c, weeksBits: "1", totalWeeks: 1, lastIsoWeek: week, spotWeeks: Math.max(1, c.spotWeeks) };
  }
  const gap = isIsoWeek(c.lastIsoWeek) ? weeksBetween(c.lastIsoWeek, week) : 1;
  if (!(gap >= 0)) return c;
  if (gap === 0) {
    if (c.weeksBits.endsWith("1")) return c;
    const bits = c.weeksBits.slice(0, -1) + "1";
    return { ...c, weeksBits: bits, spotWeeks: c.spotWeeks + 1 };
  }
  const rest = "0".repeat(Math.min(gap - 1, MAX_WEEKS_BITS));
  const bits = (c.weeksBits + rest + "1").slice(-MAX_WEEKS_BITS);
  return { ...c, weeksBits: bits, totalWeeks: bits.length, lastIsoWeek: week, spotWeeks: c.spotWeeks + 1 };
}

export interface FoldResult {
  counters: PlaceCounter[];
  counter: PlaceCounter;
  /** The stage this visit just reached, if it reached a new one. */
  stageEarned: Stage | null;
  /** True when this visit added a new Spot week. */
  newWeek: boolean;
}

function upsert(list: PlaceCounter[], next: PlaceCounter): PlaceCounter[] {
  const rest = list.filter((c) => c.placeId !== next.placeId);
  return [next, ...rest].slice(0, MAX_PLACES);
}

/** A verified visit: +1 visit, this week marked, the stage moved on. Most recent place first. */
export function foldVerified(list: PlaceCounter[], place: { id: string; name: string }, week: IsoWeek): FoldResult {
  const cur = list.find((c) => c.placeId === place.id) ?? emptyCounter(place.id, place.name, week);
  const visits = cur.visits + 1;
  const weeked = foldWeek({ ...cur, placeName: cleanPlaceName(place.name) || cur.placeName, visits }, week);
  const stage = stageFor(visits);
  const counter = { ...weeked, stage };
  return {
    counters: upsert(list, counter),
    counter,
    stageEarned: stage && stage !== cur.stage ? stage : null,
    newWeek: counter.spotWeeks > cur.spotWeeks,
  };
}

/** A visit with no verified Leave (D16): shown as "Visited", no stage, no Glory, no Spot week. */
export function foldUnverified(list: PlaceCounter[], place: { id: string; name: string }, week: IsoWeek): FoldResult {
  const cur = list.find((c) => c.placeId === place.id) ?? emptyCounter(place.id, place.name, week);
  const counter = { ...cur, unverified: (cur.unverified ?? 0) + 1 };
  return { counters: upsert(list, counter), counter, stageEarned: null, newWeek: false };
}

/** True when the count is safe this week: visited before, but not yet this week (a rest week so far). */
export const restingThisWeek = (c: PlaceCounter, week: IsoWeek) => c.spotWeeks > 0 && isIsoWeek(c.lastIsoWeek) && weeksBetween(c.lastIsoWeek, week) >= 1;

/** "3 weeks at Café Condi." from 2 weeks up (1 is just a visit). Never "in a row" (D9). */
export function spotLine(c: Pick<PlaceCounter, "spotWeeks" | "placeName">): string | null {
  return c.spotWeeks >= 2 ? `${c.spotWeeks} weeks at ${c.placeName}.` : null;
}

/** "Veteran is 2 visits away." Only when close (3 or fewer), and only to the owner. */
export function nextStageLine(visits: number): string | null {
  const n = nextStage(visits);
  if (!n || visits < 1 || n.visitsAway > 3) return null;
  return `${titleWord(n.stage)} is ${n.visitsAway} ${n.visitsAway === 1 ? "visit" : "visits"} away.`;
}

/** What account sync may send (D11): folded counts only, never the weeks bitset or a week. */
export const toSynced = (list: PlaceCounter[]): SyncedPlaceCounter[] =>
  list.map(({ placeId, placeName, visits, stage, spotWeeks }) => ({ placeId, placeName, visits, stage, spotWeeks }));

const STAGE_SET = new Set<string>(["rookie", "regular", "veteran", "elite", "legend"]);

/** Only well-formed counters survive a read; anything else in storage is ignored. */
export function parseCounters(raw: string | null | undefined): PlaceCounter[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: PlaceCounter[] = [];
    for (const c of data) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      if (typeof o.placeId !== "string" || !o.placeId || typeof o.placeName !== "string") continue;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
      const bits = typeof o.weeksBits === "string" && /^[01]*$/.test(o.weeksBits) ? o.weeksBits.slice(-MAX_WEEKS_BITS) : "";
      const visits = n(o.visits);
      out.push({
        placeId: o.placeId.slice(0, 64),
        placeName: cleanPlaceName(o.placeName),
        visits,
        weeksBits: bits,
        totalWeeks: bits.length,
        lastIsoWeek: isIsoWeek(o.lastIsoWeek) ? o.lastIsoWeek : isoWeek(new Date()),
        stage: typeof o.stage === "string" && STAGE_SET.has(o.stage) ? (o.stage as Stage) : stageFor(visits),
        spotWeeks: n(o.spotWeeks),
        ...(n(o.unverified) ? { unverified: n(o.unverified) } : {}),
      });
    }
    return out.slice(0, MAX_PLACES);
  } catch {
    return [];
  }
}

/* ---------- The open visit, between Arrive and Leave ---------- */

/** Between the two taps only. Never synced (NEVER_SYNCED); deleted on Leave. */
export interface OpenVisit {
  placeId: string;
  placeName: string;
  /** The server's sealed token: handed back on Leave, never kept by the server. */
  visitToken: string;
  /** How long this visit must last to count (0 for the one demo/testing account, decided by the server). */
  dwellMs: number;
  /** When Arrive was tapped, on this phone only, so the sheet can say "a bit later". Deleted on Leave. */
  arrivedAt: number;
  /** The plan step this visit belongs to, so its opener and plan B show while there. */
  stepId?: string;
}

export function parseOpenVisit(raw: string | null | undefined): OpenVisit | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.placeId !== "string" || typeof o.placeName !== "string" || typeof o.visitToken !== "string") return null;
    const arrivedAt = typeof o.arrivedAt === "number" && Number.isFinite(o.arrivedAt) ? o.arrivedAt : 0;
    const dwellMs = typeof o.dwellMs === "number" && o.dwellMs >= 0 ? o.dwellMs : 20 * 60e3;
    return {
      placeId: o.placeId,
      placeName: cleanPlaceName(o.placeName),
      visitToken: o.visitToken,
      dwellMs,
      arrivedAt,
      ...(typeof o.stepId === "string" ? { stepId: o.stepId } : {}),
    };
  } catch {
    return null;
  }
}

/** True when an open visit has waited too long for its Leave and should become "Visited". */
export const isStale = (v: OpenVisit, now: number) => !(v.arrivedAt > 0) || now - v.arrivedAt > MISSED_LEAVE_MS || v.arrivedAt > now + 60_000;

/** True once the dwell has passed (on this phone's clock; the server decides for real). */
export const dwellDone = (v: OpenVisit, now: number) => now - v.arrivedAt >= v.dwellMs;

/** What the Leave answer does to this phone's counts. */
export type LeaveOutcome = "counted" | "visited" | "nothing" | "keep-open";

/**
 * The Leave answer, applied: a verified visit counts; leaving early or from further away still went
 * (Visited, D16); a ride past or a second visit today adds nothing; no clear fix keeps the visit open
 * so Leave can be tapped again.
 */
export function leaveOutcome(verified: boolean, reason?: LeaveReason): LeaveOutcome {
  if (verified) return "counted";
  if (reason === "no-coords") return "keep-open";
  if (reason === "too-soon" || reason === "too-far") return "visited";
  return "nothing";
}

/* ---------- Words (easy-read, warm, no fear words) ---------- */

export type ArriveRefusal = "too-far" | "closed" | "fuzzy" | "already-today" | "no-place";

/** Why an Arrive tap didn't start a visit, in warm words. */
export function arriveRefusalLine(reason: ArriveRefusal, place: string): string {
  switch (reason) {
    case "too-far":
      return `Looks like you're not at ${place} yet. Check in when you get there!`;
    case "closed":
      return `Looks like ${place} is closed right now. Check in when it's open!`;
    case "fuzzy":
      return "Your phone isn't sure where you are yet. Step outside or near a window, then try again.";
    case "already-today":
      return `Already counted at ${place} today. Come back another day for the next one.`;
    case "no-place":
      return "We couldn't find this place right now. Try again in a moment?";
  }
}

/** Why a Leave didn't count, in warm words: one reason, never blame. */
export function leaveReasonLine(reason: LeaveReason, place: string): string {
  switch (reason) {
    case "too-soon":
      return "That was quick! Visits count after 20 minutes. Still here? Tap Leave a bit later.";
    case "too-far":
      return `You'd already left ${place} when you tapped. You still went, and that's the part that counts.`;
    case "too-fast":
      return "This one didn't count. The two taps looked like a ride, not a visit. Next time it will.";
    case "already-today":
      return `Already counted at ${place} today. Come back another day for the next one.`;
    case "no-coords":
      return "Your phone couldn't say where you are. Try Leave again in a moment.";
  }
}

/** "Counted. That's visit 3 at Café Condi." */
export function countedLine(c: Pick<PlaceCounter, "visits" | "placeName">): string {
  return c.visits === 1 ? `Counted. Your first visit at ${c.placeName}.` : `Counted. That's visit ${c.visits} at ${c.placeName}.`;
}

/* ---------- This device's storage ---------- */

const COUNTERS_KEY = STORAGE_KEYS.placeCounters;
const VISIT_KEY = STORAGE_KEYS.openVisit;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode): this visit still shows, it just isn't remembered.
  }
  notify();
}

export const loadCounters = (): PlaceCounter[] => parseCounters(get(COUNTERS_KEY));
export const saveCounters = (list: PlaceCounter[]) => set(COUNTERS_KEY, JSON.stringify(list));
export const loadOpenVisit = (): OpenVisit | null => parseOpenVisit(get(VISIT_KEY));
export const saveOpenVisit = (v: OpenVisit) => set(VISIT_KEY, JSON.stringify(v));
export const clearOpenVisit = () => set(VISIT_KEY, null);

/**
 * An open visit that waited too long for its Leave becomes "Visited" (D16), and its token and time
 * are deleted. Returns true when it settled one. Call on page load.
 */
export function settleStaleVisit(now = Date.now(), force = false): boolean {
  const v = loadOpenVisit();
  if (!v || (!force && !isStale(v, now))) return false;
  saveCounters(foldUnverified(loadCounters(), { id: v.placeId, name: v.placeName }, isoWeek(new Date(now))).counters);
  clearOpenVisit();
  return true;
}

/**
 * Applies a Leave answer on this phone: folds the counts and deletes the open visit (its token and
 * arrive time), unless the visit stays open for another try. Returns the fold for the result card.
 */
export function applyLeave(v: OpenVisit, verified: boolean, reason: LeaveReason | undefined, now = Date.now()): FoldResult | null {
  const outcome = leaveOutcome(verified, reason);
  if (outcome === "keep-open") return null;
  const place = { id: v.placeId, name: v.placeName };
  const week = isoWeek(new Date(now));
  let fold: FoldResult | null = null;
  if (outcome === "counted") fold = foldVerified(loadCounters(), place, week);
  else if (outcome === "visited") fold = foldUnverified(loadCounters(), place, week);
  if (fold) saveCounters(fold.counters);
  clearOpenVisit();
  return fold;
}

/** Forget every count on this phone (the open visit too). Glory stays: it never goes down. */
export function forgetPlaces() {
  set(COUNTERS_KEY, null);
  set(VISIT_KEY, null);
  set(STORAGE_KEYS.checkinsV1, null);
}

/** This phone's place counters, most recent first; undefined while rendering on the server. */
export function useCounters(): PlaceCounter[] | undefined {
  const raw = useSyncExternalStore(subscribe, () => get(COUNTERS_KEY), () => undefined);
  return useMemo(() => (raw === undefined ? undefined : parseCounters(raw)), [raw]);
}

/** The open visit, if any; undefined while rendering on the server. */
export function useOpenVisit(): OpenVisit | null | undefined {
  const raw = useSyncExternalStore(subscribe, () => get(VISIT_KEY), () => undefined);
  return useMemo(() => (raw === undefined ? undefined : parseOpenVisit(raw)), [raw]);
}
