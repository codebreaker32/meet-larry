// Larry's next move: ONE card on home that says the next real-world step for where the person is in
// the journey (friends-first, D25/D26). Pure: the same state and time always give the same move.
//
// Journey, in priority order:
//   1 make your card -> 2 see your Taste Fingerprint -> 3 start a group and show the QR (18+), or
//   Pick a pal / Talk taste (under 18 and no account), or Open to meet (18+) -> 4 a Plan Ticket ->
//   5 one reminder before the plan, with its opener -> 6 check in, with progress to the next title ->
//   7 the weekly move: Match Day (only with a verified fixture) > this month's quest (Explore/Return).
//
// Guardrails (PRODUCT.md, next-round-queue.md): no streaks, no feeds, every move is a real-world
// action, fewer pushes as the person progresses, and after 2 ignored moves of the same kind Larry
// offers something smaller instead. A rest week gets an easy, close option and never mentions a gap.
// The home card is not a nudge; the one shared nudge budget (2D, src/lib/nudges.ts) decides pushes,
// and uses weeklyMove() below for its single weekly slot.
import type { PlaceVibe, PlanTicket } from "./contracts";
import { GROUP_WORD } from "./groups/shared";
import { isoWeek, weeksBetween, isIsoWeek } from "./iso-week";
import { questDone, type QuestRecord } from "./quests";
import { nextStage, titleWord } from "./titles";
import type { PlaceCounter } from "./types/checkin";
import type { JourneyState, MoveKind, NextMove, NextMoveFn } from "./types/next-move";
import type { MatchDay } from "./types/signals-ui";
import type { Mood } from "./types/signals";
import type { FriendTitle } from "./types/titles";

export type { JourneyState, MoveKind, NextMove };

/** The chat word (D25), from the one constant the groups code owns; the user hasn't picked a name yet. */
export { GROUP_WORD };
/** Start a group: pick the size (2 to 5 people including you), then show the group QR. */
export const GROUP_START_HREF = "/group/new";
/** Scan someone's group QR (the join link itself is /scan#t=<token>). */
export const GROUP_SCAN_HREF = "/scan";
export const PICK_A_PAL_HREF = "/practice";
export const TALK_TASTE_HREF = "/larry";
export const OPEN_TO_MEET_HREF = "/meet";

/** Extra device facts the home card knows beyond the 0D JourneyState. All optional. */
export interface HomeExtras {
  /** An arrive with no leave yet: finish the check-in first. */
  openVisit?: { placeId: string; placeName: string } | null;
  /** This month's quest (src/lib/quests.ts). */
  quest?: QuestRecord;
  /** A shared team's next game, ONLY when 2E verified the fixture (no fixture = no date = no move). */
  matchDay?: MatchDay | null;
  /** D14 rivalry from 2B, owner only: "1 visit until you take Party Leader". */
  rivalry?: { placeId: string; title: FriendTitle; visitsAway: number } | null;
}

export type HomeState = JourneyState & HomeExtras;

/** Kinds that can be "ignored"; after 2 in a row Larry steps the size down. */
const BACK_OFF_AFTER = 2;

/** Today's mood moves the vibe; without one, the Ladder does (Regular somewhere: a cosier step up). */
export function moveVibe(mood: Mood | undefined, counters: PlaceCounter[]): PlaceVibe {
  if (mood === "chill" || mood === "low-energy") return "calm";
  if (mood === "social" || mood === "hype") return "lively";
  if (mood === "curious") return "cosy";
  return counters.some((c) => c.visits >= 3) ? "cosy" : "calm";
}

/** Ask Larry for one real, open place near the stored coarse area, at this vibe. */
export const placeHref = (vibe: PlaceVibe) => `${TALK_TASTE_HREF}?ask=place&vibe=${vibe}`;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** True when a ticket's "when" ("Sat 11am", "Today 4pm", "Tonight") falls on today's date. */
export function ticketIsToday(when: string | undefined, now: Date): boolean {
  const w = (when ?? "").trim().toLowerCase();
  if (!w) return false;
  if (/^(today|tonight|now)\b/.test(w)) return true;
  if (/^tomorrow\b/.test(w)) return false;
  const day = DAYS.findIndex((d) => w.startsWith(d));
  return day >= 0 && day === now.getDay();
}

/** A rest week: they have a Spot somewhere, and no visit yet this week. Shown only in the app, never named. */
export function isRestWeek(counters: PlaceCounter[], now: Date): boolean {
  const week = isoWeek(now);
  const spots = counters.filter((c) => c.spotWeeks > 0 && isIsoWeek(c.lastIsoWeek));
  return spots.length > 0 && spots.every((c) => weeksBetween(c.lastIsoWeek, week) >= 1);
}

function progressAt(counters: PlaceCounter[], placeId: string | undefined, rivalry: HomeExtras["rivalry"]): NextMove["progress"] {
  const c = placeId ? counters.find((x) => x.placeId === placeId) : undefined;
  const n = nextStage(c?.visits ?? 0);
  if (!n) return undefined;
  const friend = rivalry && rivalry.placeId === placeId && rivalry.visitsAway > 0 ? { title: rivalry.title, visitsAway: rivalry.visitsAway } : undefined;
  return { stage: n.stage, visitsAway: n.visitsAway, ...(friend ? { friendTitle: friend } : {}) };
}

const visitsWord = (n: number) => `${n} ${n === 1 ? "visit" : "visits"}`;

/** "Regular is 2 visits away." plus the friend title when one is within reach. */
export function progressLine(p: NextMove["progress"]): string {
  if (!p) return "";
  const stage = `${titleWord(p.stage)} is ${visitsWord(p.visitsAway)} away.`;
  return p.friendTitle ? `${stage} ${titleWord(p.friendTitle.title)} is ${visitsWord(p.friendTitle.visitsAway)} away too.` : stage;
}

// ---------------------------------------------------------------- the moves, one function each

function makeCard(): NextMove {
  return {
    kind: "make-card",
    title: "Make your taste card",
    why: "Tap the films, music, games and teams you love. I'll find the common ground from there.",
    plainWhy: "Tap pictures of things you love. It takes a minute.",
    cta: { label: "Make my taste card", href: "/create" },
    prompt: "spark",
  };
}

function fingerprint(): NextMove {
  return {
    kind: "fingerprint",
    title: "See your Taste Fingerprint",
    why: "Larry can tell how far off the beaten path your picks are. Want to see yours?",
    plainWhy: "See what makes your taste yours, from real taste data.",
    cta: { label: "See my Fingerprint", href: "/card" },
    prompt: "spark",
  };
}

function secondPerson(state: HomeState): NextMove {
  if (!state.isAdult) {
    // Under 18 or no account: device-only Larry. No groups, no Open to meet.
    return {
      kind: "warm-up",
      title: "Warm up with a pal",
      why: "Pick a made-up pal who shares some of your taste and practise one easy hello. No pressure, no audience.",
      plainWhy: "Practise saying hi with a made-up pal.",
      cta: { label: "Pick a pal", href: PICK_A_PAL_HREF },
      prompt: "spark",
      alternatives: [{ label: "Talk taste with Larry", href: TALK_TASTE_HREF }],
    };
  }
  return {
    kind: "second-person",
    title: `Start a ${GROUP_WORD.toLowerCase()} and show the QR`,
    why: "Show your QR to a friend. When they scan it, I'll find what you both love and turn it into a plan.",
    plainWhy: "Show your QR to a friend. Larry finds what you share.",
    cta: { label: `Start a ${GROUP_WORD.toLowerCase()}`, href: GROUP_START_HREF },
    prompt: "spark",
    alternatives: [
      { label: "Pick a pal first", href: PICK_A_PAL_HREF },
      { label: "Open to meet", href: OPEN_TO_MEET_HREF },
    ],
  };
}

function plan(state: HomeState): NextMove {
  const vibe = moveVibe(state.mood, state.counters);
  const low = state.mood === "low-energy";
  return {
    kind: "plan",
    title: low ? "One short, easy outing" : `One ${vibe} place, open now`,
    why: low
      ? "Low-energy day? Twenty minutes somewhere calm and close still counts. I'll find one that's open."
      : `I'll pick one real ${vibe} place near you that's open, with an easy thing to say when you get there.`,
    plainWhy: `Larry finds one ${vibe} place near you that is open.`,
    cta: { label: "Make a plan", href: placeHref(vibe) },
    prompt: "facilitator",
  };
}

function reminder(t: PlanTicket): NextMove {
  const opener = t.opener?.trim();
  return {
    kind: "reminder",
    title: `${t.place.name}, ${t.when}`,
    why: opener ? `Still on? Your opener is ready: "${opener}"` : `Still on for ${t.place.name}? Your plan is saved.`,
    plainWhy: `Your plan: ${t.place.name}, ${t.when}.`,
    cta: { label: "See my plan", href: "/steps" },
    prompt: "signal",
    evidence: { placeId: t.place.id, placeName: t.place.name, ...(t.item ? { item: t.item } : {}) },
  };
}

function checkIn(state: HomeState, place: { placeId: string; placeName: string }, arrived: boolean): NextMove {
  const progress = progressAt(state.counters, place.placeId, state.rivalry);
  // The progress line ("Regular is 2 visits away.") shows beside its stamp, not in Larry's sentence.
  return {
    kind: "check-in",
    title: arrived ? `Finish your check-in at ${place.placeName}` : `Check in at ${place.placeName}`,
    why: arrived
      ? "Tap \"I'm heading off\" when you go, 20 minutes or more after you arrived, and the visit counts."
      : "When you get there, tap \"I'm here\" on your plan. It only counts at the place, and that's what makes it yours.",
    plainWhy: arrived ? "Tap \"I'm heading off\" when you go, so the visit counts." : "Check in when you get there.",
    cta: { label: arrived ? "Finish check-in" : "Check in", href: "/steps" },
    prompt: "signal",
    ...(progress ? { progress } : {}),
    evidence: { placeId: place.placeId, placeName: place.placeName },
  };
}

function matchDayMove(m: MatchDay): NextMove | null {
  if (!m.fixture?.when || !m.fixture.teams) return null; // no verified fixture: no date, no move
  return {
    kind: "weekly",
    title: `${m.fixture.teams}, ${m.fixture.when}`,
    why: `${m.team} play ${m.fixture.when}. A calm place with a screen, done by about 10 pm, and the game does the talking.`,
    plainWhy: `${m.team} play ${m.fixture.when}. Watch it at a calm place.`,
    cta: { label: "Plan the match", href: placeHref("calm") },
    prompt: "facilitator",
  };
}

function questMove(state: HomeState, q: QuestRecord, rest: boolean): NextMove {
  const vibe = q.vibe ?? moveVibe(state.mood, state.counters);
  const left = q.goal - q.progress;
  const progressWord = `${q.progress} of ${q.goal} done.`;
  const why =
    q.kind === "return" && q.placeName
      ? rest
        ? `An easy one: ${q.placeName} again, for as long as you like.`
        : `Back to ${q.placeName}? ${left === 1 ? "One more visit" : `${left} more visits`} and this month's quest is yours.`
      : rest
        ? `An easy one: a ${vibe} place close by, just for a short visit.`
        : `${left === 1 ? "One new" : `${left} new`} ${vibe} ${left === 1 ? "place" : "places"} and this month's quest is yours.`;
  return {
    kind: "weekly",
    title: q.name,
    why,
    plainWhy: `${q.goalLine ?? ""} ${progressWord}`.trim(),
    cta: { label: q.kind === "return" && q.placeName ? "Plan a visit" : `Find a ${vibe} place`, href: placeHref(vibe) },
    prompt: "spark",
    ...(q.placeId && q.placeName ? { evidence: { placeId: q.placeId, placeName: q.placeName } } : {}),
    ...(rest ? { restWeek: true } : {}),
  };
}

/** A smaller step after 2 ignored moves of the same kind ("Was that step too big?"). */
function smaller(move: NextMove): NextMove {
  return {
    ...move,
    title: "Was that step too big?",
    why: "Here's a smaller one: somewhere calm and close, for twenty minutes. Going counts, even briefly.",
    plainWhy: "Try a short visit to a calm place near you.",
    cta: { label: "Find a calm place", href: placeHref("calm") },
    prompt: "spark",
    alternatives: undefined,
    backOff: true,
  };
}

/**
 * The weekly slot, in the accepted order: Match Day (verified fixture only) > this month's quest >
 * a plain plan. Shared by the home card and 2D's weekly push (which applies the one nudge budget).
 */
export function weeklyMove(state: HomeState, now: Date): NextMove {
  const md = state.matchDay ? matchDayMove(state.matchDay) : null;
  if (md) return md;
  if (state.quest && !questDone(state.quest)) return questMove(state, state.quest, isRestWeek(state.counters, now));
  return plan(state);
}

function ignoredTwice(ignored: MoveKind[], kind: MoveKind): boolean {
  if (ignored.length < BACK_OFF_AFTER) return false;
  return ignored.slice(-BACK_OFF_AFTER).every((k) => k === kind);
}

/** The one next move. Pure: same state and time, same move. */
export const nextMove: NextMoveFn = (journey, now) => {
  const state = journey as HomeState;
  if (!state.hasCard) return makeCard();
  // Mid-visit and today's plan come before anything new: the door out is already open.
  if (state.openVisit) return checkIn(state, state.openVisit, true);
  const t = state.openTicket;
  if (t) return ticketIsToday(t.when, now) ? checkIn(state, { placeId: t.place.id, placeName: t.place.name }, false) : reminder(t);
  if (!state.fingerprintSeen) return fingerprint();

  let move: NextMove;
  if (state.peopleMet === 0) move = secondPerson(state);
  else if (!state.counters.some((c) => c.visits > 0)) move = plan(state);
  else move = weeklyMove(state, now);

  return ignoredTwice(state.ignoredMoves, move.kind) ? smaller(move) : move;
};
