import { APP_NAME } from "./brand";
import type {
  CheckInReason,
  NextRungInput,
  NextRungResult,
  Obstacle as TicketObstacle,
  PersonaUpdate,
  PlaceCard,
  PlaceVibe,
  PlanBInput,
  PlanBResult,
  PlanTicket,
  SuggestInput,
  SuggestResult,
} from "./contracts";
import type { Mood, RequestSignals } from "./types/signals";
import type { Bridge, CommonGround, Domain, Feeling, FirstStep, Place, Profile, TasteItem } from "./types";

type DraftStep = Omit<FirstStep, "id" | "createdAt" | "done">;

/** Something small to do together with a shared item, by its kind. */
export const DO_TOGETHER: Record<Domain, (name: string) => string> = {
  movie: (n) => `Watch ${n} together`,
  tv_show: (n) => `Watch an episode of ${n} together`,
  artist: (n) => `Play each other a song by ${n}`,
  videogame: (n) => `Play ${n} together`,
  book: (n) => `Read the first page of ${n} together`,
  sports_team: (n) => `Watch a ${n} game together`,
  athlete: (n) => `Watch ${n} play together`,
  podcast: (n) => `Listen to an episode of ${n} together`,
  brand: (n) => `Tell each other what you like about ${n}`,
  destination: (n) => `Look at photos of ${n} together`,
  person: (n) => `Watch something with ${n} together`,
};

/** Lowest pressure first: saying one thing is smaller than doing something together, which is smaller than going somewhere. */
const PRESSURE: Record<FirstStep["kind"], number> = { say: 0, show: 1, go: 2 };

/**
 * Up to three tap-only First Steps from what the session already knows, so nobody has to
 * type to end with a real plan: a thing to say, a bridge to try together, and a nearby place.
 * Ordered low-pressure first, so the easiest real step is the first one offered.
 */
export function suggestSteps(opts: {
  ground: CommonGround | null;
  places: Place[];
  me: Profile;
  /** The other person on this phone, or undefined when it's unclear (example pair). */
  other?: Profile;
  practice: boolean;
}): DraftStep[] {
  const { ground, places, me, other, practice } = opts;
  const out: DraftStep[] = [];

  if (places[0]) out.push(firstVisit(places[0].name));

  const bridge = ground?.bridges[0];
  if (bridge && !practice) out.push({ kind: "show", text: DO_TOGETHER[bridge.domain](bridge.name) });

  if (practice) {
    const pick = me.items[0];
    out.push({ kind: "say", text: pick ? `Find someone who also likes ${pick.name}` : "Say hi to one new person today" });
    out.push({ kind: "show", text: "Show your taste card to someone new" });
  } else {
    const shared = ground?.shared[0];
    const theirPick = other?.items.find((i) => !me.items.some((m) => m.id === i.id));
    if (shared) out.push({ kind: "say", text: `Ask ${other?.name ?? "each other"} what ${other ? "they love" : "you love"} about ${shared.name}` });
    else if (other && theirPick) out.push({ kind: "say", text: `Ask ${other.name} about ${theirPick.name} next time` });
    else out.push({ kind: "say", text: "Say hi next time you see each other" });
  }

  return out
    .sort((x, y) => PRESSURE[x.kind] - PRESSURE[y.kind])
    .slice(0, 3)
    .map((s) => ({ ...s, text: s.text.slice(0, 140) }));
}

/**
 * Fixed First Steps from a SuggestInput, for when the AI can't write fresh ones (POST /api/suggest
 * kind "steps" falls back to these, and so do the clients). Real items only, lowest pressure first.
 */
export function fallbackSteps(input: Pick<SuggestInput, "picks" | "bridges" | "places">): DraftStep[] {
  const out: DraftStep[] = [];
  const pick = input.picks[0];
  out.push({ kind: "say", text: pick ? `Find someone who also likes ${pick}` : "Say hi to one new person today" });
  const bridge = input.bridges[0];
  out.push({ kind: "show", text: bridge ? `Show someone ${bridge} and ask what they think` : "Show your taste card to someone new" });
  const place = input.places[0];
  if (place) out.push(firstVisit(place.name));
  return out.slice(0, 3).map((s) => ({ ...s, text: s.text.slice(0, 140) }));
}

/** Short warm lines for a practice chat (at most five words), used when the AI can't write them. */
export const FALLBACK_NUDGES = [
  "Small hellos count.",
  "Ask one easy question.",
  "Short answers are fine.",
  "Curious beats clever.",
  "You're doing well.",
  "Share one thing you love.",
  "One line is enough.",
  "Take your time.",
  "Every chat is practice.",
  "Just be you.",
];

/** At most five words, so a nudge never turns into a lecture. */
export const isNudge = (line: string) => {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5 && line.length <= 40;
};

/**
 * Asks POST /api/suggest for fresh AI-written steps or nudges. Null when it fails or takes too
 * long, so the caller shows its fixed fallback instead.
 */
export async function fetchSuggest(
  /** Callers add the person's own `signals` (signalsField() from src/lib/mood.ts) so mood shapes the ideas. */
  input: SuggestInput & { signals?: RequestSignals },
  signal?: AbortSignal,
  timeoutMs = 8000,
  /** Pass apiFetch (src/lib/api-client.ts) from the browser so the access code goes along. Not imported here: this file is shared with the server. */
  fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<SuggestResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const abort = () => ctrl.abort();
  signal?.addEventListener("abort", abort);
  try {
    const res = await fetcher("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<SuggestResult>;
    return {
      steps: Array.isArray(body.steps)
        ? body.steps.filter(
            (s): s is SuggestResult["steps"][number] =>
              !!s && ["go", "say", "show"].includes(s.kind) && typeof s.text === "string" && s.text.trim() !== "",
          )
        : [],
      nudges: Array.isArray(body.nudges) ? body.nudges.filter((n): n is string => typeof n === "string" && isNudge(n)) : [],
      fallback: !!body.fallback,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// The exposure ladder for "go" steps. Each rung is a little bigger than the one before:
// 0 a short first visit, 1 a longer one, 2 going with someone, 3 inviting someone new.
const LADDER_TOP = 3;
const PLACE_IN_TEXT = [
  /^Spend 10 minutes at (.+)$/,
  /^Go back to (.+) and stay 20 minutes$/,
  /^Go to (.+) with .+$/,
  /^Invite someone new to (.+)$/,
];

/** Rung 0: the first, short visit to a place. */
export function firstVisit(place: string): DraftStep {
  return { kind: "go", text: `Spend 10 minutes at ${place}`, rung: 0 };
}

/** The place named in a ladder step's text, when the app wrote it. */
function placeIn(text: string): string | null {
  for (const re of PLACE_IN_TEXT) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

/**
 * The next rung after a finished "go" step, as a one-tap suggestion saved with rung + 1.
 * Null for other kinds of step, and at the top of the ladder (they don't need the app for this any more).
 */
export function nextRung(step: Pick<FirstStep, "kind" | "text" | "rung" | "withPerson">): DraftStep | null {
  if (step.kind !== "go") return null;
  const rung = step.rung ?? 0;
  if (rung >= LADDER_TOP) return null;
  const place = placeIn(step.text);
  const who = step.withPerson;
  const text =
    rung === 0
      ? place
        ? `Go back to ${place} and stay 20 minutes`
        : "Go again and stay 20 minutes"
      : rung === 1
        ? place
          ? `Go to ${place} with ${who ?? "someone"}`
          : `Go with ${who ?? "someone"}`
        : place
          ? `Invite someone new to ${place}`
          : "Invite someone new";
  const next: DraftStep = { kind: "go", text: text.slice(0, 140), rung: rung + 1 };
  if (who && rung === 1) next.withPerson = who;
  return next;
}

/** True when a finished "go" step was the last rung of its ladder. */
export const ladderDone = (step: Pick<FirstStep, "kind" | "rung" | "done">) =>
  step.kind === "go" && step.done && (step.rung ?? 0) >= LADDER_TOP;

/* ---------- Plan Ticket and the Quiet-to-Lively Ladder ---------- */

// The ladder's rungs are real places, graded by vibe: 0 calm, 1 cosy, 2 lively. A Plan Ticket
// carries its rung, and the private check-in after a step moves the next one up, keeps it, or
// steps it back.

export const VIBES: readonly PlaceVibe[] = ["calm", "cosy", "lively"];
export const VIBE_WORD: Record<PlaceVibe, string> = { calm: "Calm", cosy: "Cosy", lively: "Lively" };
export const TOP_RUNG = VIBES.length - 1;

const clampRung = (rung: number) => (Number.isFinite(rung) ? Math.min(TOP_RUNG, Math.max(0, Math.round(rung))) : 0);
export const rungOf = (vibe: PlaceVibe) => Math.max(0, VIBES.indexOf(vibe));
export const vibeAt = (rung: number): PlaceVibe => VIBES[clampRung(rung)];

const QUIET_WORDS = /\b(quiet|calm|peaceful)\b/;
const LIVELY_WORDS = /arcade|bowling|karaoke|market|food hall|stadium|cricket ground|escape room|climbing|live music|busy|lively|crowded/;
const CALM_WORDS = /library|book|tea|museum|gallery|garden|park|reading/;

/** The place's vibe: Qloo-graded when the server sent one, otherwise a careful guess from its own tags. */
export function vibeOf(place: { tags: string[]; vibe?: PlaceVibe }): PlaceVibe {
  if (place.vibe && VIBES.includes(place.vibe)) return place.vibe;
  const t = place.tags.join(" ").toLowerCase();
  if (QUIET_WORDS.test(t)) return "calm";
  if (LIVELY_WORDS.test(t)) return "lively";
  if (CALM_WORDS.test(t)) return "calm";
  return "cosy";
}

/**
 * After a step, the private check-in moves the ladder: Easy goes up a rung, OK and Hard stay. Hard
 * keeps the rung and offers a shorter visit instead of stepping back (final-build-plan, 1B), so one
 * rough day never undoes progress. "Too loud" still steps down (targetRung).
 */
export function rungAfter(rung: number, feeling: Feeling): number {
  const r = clampRung(rung);
  if (feeling === "good") return Math.min(r + 1, TOP_RUNG);
  return r;
}

/** The one-tap "why" in the private check-in after a place step. */
export const CHECK_IN_REASONS: { id: CheckInReason; label: string }[] = [
  { id: "too_loud", label: "Too loud" },
  { id: "no_one", label: "Didn't know anyone" },
  { id: "cant_find", label: "Couldn't find it" },
  { id: "loved", label: "Loved it" },
];

/**
 * The rung the fixed table aims for (the offline fallback; Larry decides when it can): the feeling
 * moves it, and the reason can override that. Too loud never goes up; couldn't find it stays.
 */
export function targetRung(from: number, feeling: Feeling, reason?: CheckInReason): number {
  const r = rungAfter(from, feeling);
  if (reason === "too_loud") return Math.max(0, Math.min(r, clampRung(from) - 1));
  if (reason === "cant_find") return clampRung(from);
  if (reason === "loved") return Math.max(r, clampRung(from));
  return r;
}

/** What Larry learns from a check-in reason, for the persona. Nothing is learned from logistics. */
export function learnedFromCheckIn(reason: CheckInReason | undefined, vibe: PlaceVibe | undefined): PersonaUpdate | undefined {
  const base: PersonaUpdate = { addLikes: [], addDislikes: [], addNotes: [] };
  if (reason === "too_loud") return { ...base, placeVibe: vibe === "calm" ? "calm" : vibeAt(rungOf(vibe ?? "cosy") - 1), addNotes: ["finds loud places hard"] };
  if (reason === "loved" && vibe) return { ...base, placeVibe: vibe };
  if (reason === "no_one") return { ...base, addNotes: ["finds new places easier with someone they know"] };
  return undefined;
}

/** The plan parts a saved First Step may carry (stored with the step on this phone only). */
export interface PlanFields {
  placeId?: string;
  placeName?: string;
  placeImage?: string;
  vibe?: PlaceVibe;
  when?: string;
  item?: PlanTicket["item"];
  opener?: string;
  planB?: string;
  /** The one if-then line the person committed to (shown again on the step and in reminders). */
  ifThen?: string;
  /** The ticket's id, so a reminder (2D) or co-presence can name this plan. */
  ticketId?: string;
  /** "How do you think it'll go?" (1-5), if they guessed. Stays on this phone. */
  guess?: 1 | 2 | 3 | 4 | 5;
  /** The worry they tapped, if any. */
  obstacle?: Obstacle;
}
export type PlanDraft = DraftStep & PlanFields;
export type PlanStep = FirstStep & PlanFields;

/** A First Step that points to a real place (from a Plan Ticket or a ladder rung). */
export const isPlaceStep = (s: FirstStep): s is PlanStep & { placeId: string; placeName: string } =>
  typeof (s as PlanStep).placeId === "string" && typeof (s as PlanStep).placeName === "string";

/** The rung a saved step stands on: its own rung, or its place's vibe. */
export const stepRung = (s: PlanStep): number => (s.vibe ? rungOf(s.vibe) : clampRung(s.rung ?? 0));

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Sat 11am" for a day offset and an hour. */
function slot(now: Date, addDays: number, hour: number): { day: number; label: string } {
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { day: d.getDay(), label: `${DAY_NAMES[d.getDay()].slice(0, 3)} ${h12}${hour < 12 ? "am" : "pm"}` };
}

/** The day number (0 = Sunday) for "Mon", "Tues", "Thursday", "Sundays" and so on, or -1. */
function dayNumber(word: string): number {
  const base = word.toLowerCase().replace(/s$/, "");
  if (base.length < 3) return -1;
  return DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(base));
}

/**
 * True when the hours text says the place is closed on that day: "Sunday: Closed", "Sun closed",
 * and ranges such as "Mon-Wed closed" or "Closed Mon–Tue".
 */
export function closedOn(hours: string, day: number): boolean {
  for (const part of hours.split(/[;,\n|]/)) {
    if (!/\bclosed\b/i.test(part)) continue;
    const range = /\b([a-z]{3,9})\s*(?:-|–|—|to)\s*([a-z]{3,9})\b/i.exec(part);
    if (range) {
      const from = dayNumber(range[1]);
      const to = dayNumber(range[2]);
      if (from >= 0 && to >= 0) {
        // Ranges may wrap round the week ("Sat-Mon").
        if (from <= to ? day >= from && day <= to : day >= from || day <= to) return true;
        continue;
      }
    }
    if (/\b(daily|every day)\b/i.test(part)) return true;
    for (const word of part.match(/[a-z]+/gi) ?? []) if (dayNumber(word) === day) return true;
  }
  return false;
}

/**
 * True when a time reads as daytime (9am to 7pm, or "morning"/"afternoon"). Plans between people
 * who just met are daytime only, so anything else is dropped from the chips.
 */
export function isDaytime(when: string): boolean {
  if (/\b(evening|night|late)\b/i.test(when)) return false;
  const m = /\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/i.exec(when);
  if (!m) return true;
  const h = Number(m[1]) % 12 + (m[2].toLowerCase() === "pm" ? 12 : 0);
  return h >= 9 && h <= 19;
}

/**
 * Two or three daytime time chips in the coming week: the next weekday afternoon, Saturday
 * morning and Sunday afternoon. Days the hours text says are closed are left out.
 */
export function daytimeSlots(now: Date, hours?: string): string[] {
  const today = now.getDay();
  const toSat = (6 - today + 7) % 7 || 7;
  const toSun = (7 - today) % 7 || 7;
  // Tomorrow if that's a weekday, otherwise Monday.
  const tomorrow = (today + 1) % 7;
  const toWeekday = tomorrow === 0 ? 2 : tomorrow === 6 ? 3 : 1;
  const out = [slot(now, toWeekday, 16), slot(now, toSat, 11), slot(now, toSun, 14)]
    .sort((x, y) => ((x.day - today + 7) % 7) - ((y.day - today + 7) % 7))
    .filter((s) => !hours || !closedOn(hours, s.day))
    .map((s) => s.label);
  return out.length ? out : ["Any afternoon"];
}

/**
 * Daytime time chips for a ticket. The place's own slots come first: the server worked them out
 * from real opening hours (open at that time, and not near closing). Larry's time leads when it is
 * one of them. Only when the place has no known hours are generic daytime chips offered, and then
 * `checkDoor` is true so the ticket says to check the door first.
 */
export function ticketTimes(ticket: PlanTicket, now: Date): { choices: string[]; checkDoor: boolean } {
  const slots = (ticket.place.slots ?? []).filter((s) => s && isDaytime(s));
  if (slots.length) {
    const own = ticket.when && slots.includes(ticket.when) ? [ticket.when] : [];
    return { choices: [...own, ...slots.filter((s) => s !== ticket.when)].slice(0, 3), checkDoor: false };
  }
  const own = ticket.when && isDaytime(ticket.when) && !/check the door/i.test(ticket.when) ? [ticket.when] : [];
  return { choices: [...own, ...daytimeSlots(now, ticket.place.hours).filter((s) => s !== ticket.when)].slice(0, 3), checkDoor: true };
}

/** Daytime time chips for a ticket (see ticketTimes). */
export function whenChoices(ticket: PlanTicket, now: Date): string[] {
  return ticketTimes(ticket, now).choices;
}

/** Shape any place into a PlaceCard (no per-person fit when Qloo/Larry didn't give one). */
export function asPlaceCard(place: Place | PlaceCard): PlaceCard {
  const card = place as Partial<PlaceCard> & Place;
  return { ...card, fits: Array.isArray(card.fits) ? card.fits : [], vibe: vibeOf(card) };
}

/**
 * A Plan Ticket built on the device from a place someone chose and the best bridge, for when Larry
 * hasn't written one. Real data only: the place, a daytime slot and a shared item.
 */
export function buildTicket(opts: {
  place: Place | PlaceCard;
  bridge?: Pick<Bridge, "id" | "name" | "domain" | "image">;
  shared?: TasteItem;
  now?: Date;
}): PlanTicket {
  const place = asPlaceCard(opts.place);
  const thing = opts.bridge ?? opts.shared;
  const opener = opts.bridge
    ? `Have you tried ${opts.bridge.name}?`
    : opts.shared
      ? `What do you love about ${opts.shared.name}?`
      : "What do you like doing here?";
  return {
    place,
    // The place's own hours-checked slot when the server sent one; generic chips only without.
    when: place.slots?.find(isDaytime) ?? daytimeSlots(opts.now ?? new Date(), place.hours)[0],
    ...(thing ? { item: { id: thing.id, name: thing.name, domain: thing.domain, ...(thing.image ? { image: thing.image } : {}) } } : {}),
    opener,
    rung: rungOf(place.vibe ?? "cosy"),
  };
}

/** The First Step a Plan Ticket saves: a "go" step that keeps the place, time, item, opener and plan B. */
export function stepFromTicket(
  ticket: PlanTicket,
  opts: { when?: string; planB?: string; withPerson?: string; ifThen?: string; guess?: PlanFields["guess"]; obstacle?: Obstacle } = {},
): PlanDraft {
  const when = opts.when ?? ticket.when;
  const base = `Go to ${ticket.place.name}, ${when}.`;
  const full = ticket.item ? `${base} Bring up ${ticket.item.name}.` : base;
  const vibe = vibeOf(ticket.place);
  const planB = opts.planB ?? ticket.planB;
  return {
    kind: "go",
    text: (full.length <= STEP_TEXT_LIMIT ? full : base).slice(0, STEP_TEXT_LIMIT),
    rung: ticket.rung ?? rungOf(vibe),
    placeId: ticket.place.id,
    placeName: ticket.place.name,
    ...(ticket.place.image ? { placeImage: ticket.place.image } : {}),
    vibe,
    when,
    ...(ticket.item ? { item: ticket.item } : {}),
    opener: ticket.opener,
    ...(planB ? { planB } : {}),
    ...(opts.withPerson ? { withPerson: opts.withPerson } : {}),
    ...(opts.ifThen ?? ticket.ifThen ? { ifThen: opts.ifThen ?? ticket.ifThen } : {}),
    ...(ticket.id ? { ticketId: ticket.id } : {}),
    ...(opts.guess ?? ticket.guess ? { guess: opts.guess ?? ticket.guess } : {}),
    ...(opts.obstacle ?? ticket.obstacle ? { obstacle: opts.obstacle ?? ticket.obstacle } : {}),
  };
}
const STEP_TEXT_LIMIT = 140;

/** Every worry on the ticket: the four with a Larry plan B, plus "too loud" and "I'll want to leave". */
export type Obstacle = TicketObstacle;

export const OBSTACLES: { id: Obstacle; label: string }[] = [
  { id: "nervous", label: "I feel nervous" },
  { id: "words", label: "I don't know what to say" },
  { id: "alone", label: "No one to go with" },
  { id: "travel", label: "I can't get there" },
  { id: "loud", label: "It might be too loud" },
  { id: "leave", label: "I'll want to leave" },
];

/** The fixed if-then plan B for the worry someone tapped (the fallback while Larry writes one). */
export function planBFor(obstacle: Obstacle, ticket: PlanTicket): string {
  const vibe = vibeOf(ticket.place);
  switch (obstacle) {
    case "nervous":
      return "If I feel nervous, I'll stay 10 minutes. Then I'm allowed to leave.";
    case "words":
      return ticket.item
        ? `If I don't know what to say, I'll bring up ${ticket.item.name}.`
        : "If I don't know what to say, I'll read my line from this ticket.";
    case "alone":
      return vibe === "lively"
        ? "If no one can come, I'll pick a calmer place and go on my own for 10 minutes."
        : `If no one can come, I'll go on my own for 10 minutes. It's a ${vibe} place.`;
    case "travel":
      return `If I can't get there, I'll ask ${APP_NAME} for somewhere nearer.`;
    case "loud":
      return `If ${ticket.place.name} is too loud, I'll step outside for a minute, then find a quieter corner.`;
    case "leave":
      return "If I want to leave, I'll say \"I've got to head off\" and go. That still counts.";
  }
}

// ---------------------------------------------------------------- the if-then line

const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

/** The opener as it sits inside the line: no wrapping quotes, ends with a mark. */
function quoted(opener: string): string {
  const t = opener.trim().replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

/**
 * The one line the person commits to (implementation intention): "If it's Sat 3pm, then I walk to
 * Café Condi and say: "Have you played Cascadia?"". Low energy gets a gentler, shorter line. A time
 * like "Any afternoon" reads as "If it's an afternoon this week". Built only from the ticket's real
 * place, the chosen time and the opener Larry wrote.
 */
export function ifThenLine(ticket: Pick<PlanTicket, "place">, when: string, opener: string, opts: { mood?: Mood | null } = {}): string {
  const w = when.trim();
  const cue = /^(any|an?)\b/i.test(w) ? `If it's ${w.replace(/^any\b/i, "an").toLowerCase()} this week` : `If it's ${w || "the day we picked"}`;
  const line = opener.trim() ? quoted(opener) : "";
  if (opts.mood === "low-energy") {
    return line ? `${cue}, I pop into ${ticket.place.name} for 10 minutes and say: "${line}"` : `${cue}, I pop into ${ticket.place.name} for 10 minutes.`;
  }
  return line ? `${cue}, then I walk to ${ticket.place.name} and say: "${line}"` : `${cue}, then I walk to ${ticket.place.name}.`;
}

/** The same line for a screen reader: days and times spelt out, the quote read after a colon. */
export function ifThenSpoken(line: string): string {
  return line
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b(?=\s+\d)/g, (d) => DAY_FULL[d] ?? d)
    .replace(/\b(\d{1,2})(?::(\d{2}))?(am|pm)\b/g, (_m, h, mm, ap) => `${h}${mm ? `:${mm}` : ""} ${ap === "am" ? "a.m." : "p.m."}`)
    .replace(/[“”"]/g, "");
}

// ---------------------------------------------------------------- the guess, once a week

/** ISO week id ("2026-W44") for a date, Monday first. */
export function isoWeekId(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** True when no guess was made this ISO week (the guess is optional and asked at most weekly). */
export function guessAllowed(lastWeek: unknown, now: Date = new Date()): boolean {
  return typeof lastWeek !== "string" || lastWeek !== isoWeekId(now);
}

// ---------------------------------------------------------------- fit

/** A place nobody is judged "not-for-them" at: the only kind a ticket or a second stop should use. */
export const goodFit = (place: Pick<PlaceCard, "fits">): boolean => !(place.fits ?? []).some((f) => f.likely === "not-for-them");

// ---------------------------------------------------------------- ticket extras (POST /api/suggest kind "ticket")

/** A stop on a multi-stop plan. */
export interface TicketStop {
  id: string;
  name: string;
  /** What kind of place, e.g. "A bookshop." (from Qloo). */
  kind?: string;
  vibe?: PlaceVibe;
}

/** What the ticket sends to be filled in: the real place, the item, and a coarse start (about 1 km). */
export interface TicketExtrasInput {
  kind: "ticket";
  place: { id: string; name: string; hours?: string; slots?: string[]; vibe?: PlaceVibe; tags?: string[]; reason?: string; at?: { lat: number; lon: number } };
  item?: { id: string; name: string };
  /** Pick ids, so Qloo can find a second stop near the place. */
  picks?: string[];
  /** The ticket's opener: kept unless it is a plain template, then Larry writes a fresh one. */
  opener?: string;
  /** Coarse start (rounded to about 1 km), for the walking time. Never stored. */
  start?: { lat: number; lon: number };
  signals?: RequestSignals;
  /** The second stop Larry already chose in the chat (PlanTicket.then), used instead of a fresh pick. */
  then?: { id: string; name: string; vibe?: PlaceVibe; reason?: string };
}

export interface TicketExtras {
  /** Easy-read hours, from Qloo or (when Qloo had none) Amazon Location. */
  hours?: string;
  /** Daytime chips worked out from those hours. */
  slots?: string[];
  hoursFrom?: "qloo" | "amazon";
  /** Amazon's open-right-now flag (null or absent when unknown). */
  openNow?: boolean | null;
  /** Walking minutes from the coarse start (Amazon Routes), when known and walkable. */
  walkMin?: number;
  /** A short multi-stop plan in walking order (café, then bookshop, then a walk), when two good places are close. */
  route?: { stops: TicketStop[]; walks: (number | null)[]; line: string; fromLarry: boolean };
  /** Larry's fresh opener, when the ticket's own was a plain template. */
  opener?: string;
  /** True when no model wrote anything (fixed lines only). */
  fallback: boolean;
}

/** A fixed opener template (the agent's or the device's fallback), which Larry should replace. */
export const isTemplateOpener = (opener: string | undefined): boolean =>
  !opener?.trim() || /^(Have you (ever )?tried .+\?|What do you love about .+\?|What do you like doing here\?|What have you been into lately\?|What do you think of .+\?)$/i.test(opener.trim());

/** "12 min walk". */
export const walkText = (min: number) => `${Math.max(1, Math.round(min))} min walk`;

/** The fixed route line: "First Café Condi. Then a 6 min walk to Kitab Khana. Then a slow walk, no rush." */
export function routeLineFallback(stops: TicketStop[], walks: (number | null)[]): string {
  const parts = stops.map((s, i) => (i === 0 ? `First ${s.name}.` : `Then ${walks[i - 1] ? `a ${walkText(walks[i - 1]!)}` : "a short walk"} to ${s.name}.`));
  return [...parts, "Then a slow walk, no rush."].join(" ");
}

/** The ticket with the extras folded in: Amazon hours and slots only fill gaps, Larry's opener replaces a template. */
export function withExtras(ticket: PlanTicket, extras: TicketExtras | null): PlanTicket {
  if (!extras) return ticket;
  const place = { ...ticket.place };
  if (!place.hours && extras.hours) place.hours = extras.hours;
  if (!place.slots?.length && extras.slots?.length) place.slots = extras.slots;
  const opener = extras.opener && isTemplateOpener(ticket.opener) ? extras.opener : ticket.opener;
  return { ...ticket, place, opener };
}

/** Asks Larry (POST /api/suggest, kind "ticket") to fill in hours, walking time, a second stop and lines. Null on any failure. */
export async function fetchTicketExtras(
  input: TicketExtrasInput,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 20_000,
): Promise<TicketExtras | null> {
  try {
    const res = await fetcher("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<TicketExtras>;
    return typeof body.fallback === "boolean" ? (body as TicketExtras) : null;
  } catch {
    return null;
  }
}

export interface LadderPlace {
  id: string;
  name: string;
  vibe: PlaceVibe;
  image?: string;
  /** What Qloo says about the place, so Larry can choose between them. */
  tags?: string[];
  about?: string;
}

/**
 * Real places for each rung: those in this person's saved plans first (newest first), then places
 * Qloo found for their taste. Each place appears once.
 */
export function ladderPlaces(steps: FirstStep[], found: (Place | PlaceCard)[] = []): Record<PlaceVibe, LadderPlace[]> {
  const out: Record<PlaceVibe, LadderPlace[]> = { calm: [], cosy: [], lively: [] };
  const seen = new Set<string>();
  const add = (p: LadderPlace) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out[p.vibe].push(p);
  };
  for (const s of steps) {
    if (!isPlaceStep(s)) continue;
    add({ id: s.placeId, name: s.placeName, vibe: s.vibe ?? vibeAt(s.rung ?? 0), ...(s.placeImage ? { image: s.placeImage } : {}) });
  }
  for (const p of found) {
    const about = (p as PlaceCard).about;
    add({ id: p.id, name: p.name, vibe: vibeOf(p as PlaceCard), ...(p.image ? { image: p.image } : {}), tags: p.tags.slice(0, 6), ...(about ? { about } : {}) });
  }
  return out;
}

/**
 * Where this person is on the ladder: the last finished place step, moved by how it felt
 * (unanswered counts as OK). Before any, the rung of their latest planned place, or calm.
 */
export function currentRung(steps: FirstStep[]): number {
  const placed = steps.filter(isPlaceStep);
  const lastDone = placed.filter((s) => s.done).sort((x, y) => (y.doneAt ?? y.createdAt) - (x.doneAt ?? x.createdAt))[0];
  if (lastDone) return rungAfter(stepRung(lastDone), lastDone.feeling ?? "okay");
  const open = placed.find((s) => !s.done);
  return open ? stepRung(open) : 0;
}

/**
 * The next ladder suggestion after a finished place step. "Stay" prefers the same place again (it
 * is how somewhere becomes yours); up or back prefers a different place on the new rung. `place` is
 * missing when no real place is known for that rung yet: then Larry is asked for one.
 */
export function nextOnLadder(
  step: PlanStep,
  feeling: Feeling,
  pool: Record<PlaceVibe, LadderPlace[]>,
  reason?: CheckInReason,
): { rung: number; vibe: PlaceVibe; move: "up" | "stay" | "back"; top: boolean; place?: LadderPlace } {
  const from = stepRung(step);
  const rung = targetRung(from, feeling, reason);
  const move = rung > from ? "up" : rung < from ? "back" : "stay";
  const vibe = vibeAt(rung);
  const options = pool[vibe];
  const same = options.find((p) => p.id === step.placeId);
  const other = options.find((p) => p.id !== step.placeId);
  const place = move === "stay" ? (same ?? other) : (other ?? same);
  return { rung, vibe, move, top: from === TOP_RUNG && feeling === "good" && reason !== "too_loud", ...(place ? { place } : {}) };
}

/** The fixed table's answer to a next_rung request (the offline fallback, and the server's when the model can't). */
export function nextRungFallback(input: Omit<NextRungInput, "kind">): NextRungResult {
  const pool: Record<PlaceVibe, LadderPlace[]> = { calm: [], cosy: [], lively: [] };
  for (const c of input.candidates) pool[c.vibe]?.push(c);
  const step = { ...input.step, kind: "go", rung: 0 } as unknown as PlanStep;
  const n = nextOnLadder(step, input.feeling, pool, input.reason);
  const word = VIBE_WORD[n.vibe].toLowerCase();
  const why =
    input.reason === "too_loud"
      ? `Too loud is useful to know. Somewhere ${word} next.`
      : input.reason === "cant_find"
        ? "Same place again, now you know the way."
        : n.move === "up"
          ? `That went well. Next time: somewhere ${word}.`
          : n.move === "back"
            ? `No rush. Something ${word} next time.`
            : n.place?.id === input.step.placeId
              ? "Same kind of place again. Going back is how a place becomes yours."
              : `Same again: another ${word} place.`;
  const learned = learnedFromCheckIn(input.reason, input.step.vibe);
  return { ...(n.place ? { placeId: n.place.id } : {}), vibe: n.vibe, move: n.move, why, ...(learned ? { learned } : {}), fallback: true };
}

/** Asks Larry (POST /api/suggest, kind "next_rung") for the next rung. Null on any failure. */
export async function fetchNextRung(
  input: NextRungInput,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 12_000,
): Promise<NextRungResult | null> {
  try {
    const res = await fetcher("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<NextRungResult>;
    if (typeof body.why !== "string" || !body.vibe || !VIBES.includes(body.vibe) || !body.move) return null;
    if (body.placeId !== undefined && !input.candidates.some((c) => c.id === body.placeId)) return null;
    return body as NextRungResult;
  } catch {
    return null;
  }
}

/** A plan B request with every ticket worry, and the person's own signals (mood). */
export type TicketPlanBInput = Omit<PlanBInput, "obstacle" | "place"> & {
  obstacle: Obstacle;
  signals?: RequestSignals;
  /** place.at: the venue's own pin, so "too loud" looks for a calmer place near it. */
  place: PlanBInput["place"] & { at?: { lat: number; lon: number } };
};

/** Asks Larry (POST /api/suggest, kind "plan_b") for a plan B. Null on any failure. */
export async function fetchPlanB(
  input: TicketPlanBInput,
  fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 15_000,
): Promise<PlanBResult | null> {
  try {
    const res = await fetcher("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<PlanBResult>;
    return typeof body.planB === "string" && body.planB.trim() ? (body as PlanBResult) : null;
  } catch {
    return null;
  }
}

/** A one-tap First Step for a real ladder place. */
export function ladderStep(place: LadderPlace, withPerson?: string): PlanDraft {
  return {
    ...firstVisit(place.name),
    rung: rungOf(place.vibe),
    placeId: place.id,
    placeName: place.name,
    vibe: place.vibe,
    ...(place.image ? { placeImage: place.image } : {}),
    ...(withPerson ? { withPerson } : {}),
  };
}
