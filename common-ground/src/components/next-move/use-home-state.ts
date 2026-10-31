"use client";

import * as React from "react";
import { useAgeBucket } from "@/lib/age";
import { authFetch } from "@/lib/firebase/client";
import type { GroupListResponse } from "@/lib/groups/shared";
import { useCounters, useOpenVisit } from "@/lib/checkins";
import type { PlanTicket } from "@/lib/contracts";
import { useMood } from "@/lib/mood";
import type { HomeState } from "@/lib/next-move";
import { usePersona } from "@/lib/persona";
import { currentQuest, parseQuests, type QuestRecord } from "@/lib/quests";
import { readStored, useStored, useSteps, writeStored } from "@/lib/storage";
import { isPlaceStep, type PlanStep } from "@/lib/suggest-steps";
import type { FirstStep } from "@/lib/types";
import type { MoveKind } from "@/lib/types/next-move";
import type { MatchDay } from "@/lib/types/signals-ui";
import { isAdultBucket } from "@/lib/types/signals";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";

/**
 * A device-side count of groups met (a number only, no ids or names), for when the account's group
 * list can't be read. People named on saved plans count too.
 */
export const GROUPS_MET_KEY = "larry.groups.met";
/** Back-off memory: at most this many skipped moves are kept. */
const IGNORED_MAX = 6;

/** The newest plan that is still open (not done), as the ticket the home card talks about. */
export function openTicketFrom(steps: FirstStep[]): PlanTicket | undefined {
  const open = steps
    .filter((s): s is PlanStep & { placeId: string; placeName: string } => !s.done && isPlaceStep(s) && !!(s as PlanStep).when)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!open) return undefined;
  return {
    place: { id: open.placeId, name: open.placeName, affinity: 0, tags: [], fits: [], ...(open.vibe ? { vibe: open.vibe } : {}) },
    when: open.when ?? "",
    opener: open.opener ?? "",
    ...(open.item ? { item: open.item } : {}),
    ...(open.ticketId ? { id: open.ticketId } : {}),
  };
}

/** People met: groups formed on this device, plus distinct people named on saved plans (pairs and rooms). */
export function peopleMetFrom(steps: FirstStep[], groups: number): number {
  const named = new Set(steps.map((s) => s.withPerson?.trim().toLowerCase()).filter(Boolean));
  return Math.max(0, Math.floor(groups) || 0) + named.size;
}

export function parseIgnored(raw: unknown): MoveKind[] {
  return Array.isArray(raw) ? (raw.filter((k) => typeof k === "string") as MoveKind[]).slice(-IGNORED_MAX) : [];
}

/** "Not now" on a move: remembered (kind only) so Larry can step the size down after two. */
export function skipMove(kind: MoveKind) {
  const list = parseIgnored(readStored<unknown>(STORAGE_KEYS.ignoredMoves, []));
  writeStored(STORAGE_KEYS.ignoredMoves, [...list, kind].slice(-IGNORED_MAX));
}

/** Taking a move resets the back-off. */
export function tookMove() {
  writeStored(STORAGE_KEYS.ignoredMoves, null);
}

/** Keeps this month's quest on the device (latest month only). */
export function saveQuest(q: QuestRecord) {
  writeStored(STORAGE_KEYS.quests, [q]);
}

/**
 * A shared team's next game from 2E (GET /api/matchday). Used only when the fixture is verified
 * (a date and teams); otherwise there is no Match Day move at all. Quietly absent if the route is.
 */
function useMatchDay(teamIds: string): MatchDay | null {
  const [state, setState] = React.useState<{ key: string; md: MatchDay | null }>({ key: "", md: null });
  React.useEffect(() => {
    if (!teamIds) return;
    const ctrl = new AbortController();
    fetch(`/api/matchday?entities=${encodeURIComponent(teamIds)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: MatchDay[] | { matchDays?: MatchDay[] } | null) => {
        const list = Array.isArray(body) ? body : (body?.matchDays ?? []);
        const md = list.find((m) => m && typeof m.team === "string" && m.fixture?.when && m.fixture.teams) ?? null;
        setState({ key: teamIds, md });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [teamIds]);
  return teamIds && state.key === teamIds ? state.md : null;
}

/**
 * Groups with at least one other person in them, from the signed-in account (GET /api/groups).
 * null when signed out or unreadable: the device count stands in.
 */
function useGroupsWithPeople(signedIn: boolean): number | null {
  const [n, setN] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!signedIn) return;
    const ctrl = new AbortController();
    authFetch("/api/groups", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: GroupListResponse | null) => {
        if (body && Array.isArray(body.groups)) setN(body.groups.filter((g) => Array.isArray(g.names) && g.names.length > 0).length);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [signedIn]);
  return signedIn ? n : null;
}

/** Everything the home card needs, read from this device. undefined until the device has been read. */
export function useHomeState(now: Date): HomeState | undefined {
  const persona = usePersona();
  const steps = useSteps();
  const counters = useCounters();
  const openVisit = useOpenVisit();
  const mood = useMood();
  const age = useAgeBucket();
  const seen = useStored<unknown>(STORAGE_KEYS.fingerprintSeen, false);
  const ignoredRaw = useStored<unknown>(STORAGE_KEYS.ignoredMoves, []);
  const questsRaw = useStored<unknown>(STORAGE_KEYS.quests, []);
  const groups = useStored<unknown>(GROUPS_MET_KEY, 0);
  const signedIn = useStored<unknown>(STORAGE_KEYS.authSignedIn, null);
  const accountGroups = useGroupsWithPeople(signedIn === 1 || signedIn === "1" || signedIn === true);

  const teamIds = React.useMemo(
    () => (persona?.likes ?? []).filter((i) => i.domain === "sports_team").slice(0, 5).map((i) => i.id).join(","),
    [persona],
  );
  const matchDay = useMatchDay(teamIds);

  const quest = React.useMemo(
    () => (counters ? currentQuest(parseQuests(questsRaw), counters, now, { mood: mood ?? undefined }) : undefined),
    [counters, questsRaw, now, mood],
  );
  // Keep the quest (and its starting line) once it exists or moves on.
  React.useEffect(() => {
    if (!quest) return;
    const stored = parseQuests(questsRaw);
    const same = stored.length === 1 && JSON.stringify(stored[0]) === JSON.stringify(quest);
    if (!same) saveQuest(quest);
  }, [quest, questsRaw]);

  if (persona === undefined || steps === undefined || counters === undefined || openVisit === undefined || mood === undefined || age === undefined) {
    return undefined;
  }
  return {
    hasCard: !!persona && persona.likes.length > 0,
    fingerprintSeen: seen === true,
    peopleMet: peopleMetFrom(steps, Math.max(accountGroups ?? 0, typeof groups === "number" ? groups : 0)),
    openTicket: openTicketFrom(steps),
    counters,
    ...(mood ? { mood } : {}),
    ...(age ? { ageBucket: age } : {}),
    ignoredMoves: parseIgnored(ignoredRaw),
    isAdult: isAdultBucket(age),
    source: "web",
    openVisit: openVisit ? { placeId: openVisit.placeId, placeName: openVisit.placeName } : null,
    ...(quest ? { quest } : {}),
    matchDay,
  };
}
