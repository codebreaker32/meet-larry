// Match Day (qloo-hooks-plan 3.1, minimal build): the one Qloo feature that starts from an event
// already in the world. Pure and safe on the device: the Qloo search is passed in (resolveTeam), so
// the Plan Ticket can use the copy and the checks without pulling server code.
//
// Truth rules (never cut):
//  - Fixtures are NOT from Qloo. They come only from FIXTURES below, each with its source, and the
//    list stays EMPTY unless a fixture was checked by hand. No fixture = no date: never a dateless
//    "next game", never an invented match. The honest off-season line takes its place.
//  - Evening games are allowed (user decision, 31 Oct): a calm place with a screen, the match ending
//    by about 10 pm local time; a daytime highlights plan is plan B.
//  - Qloo has no "has a screen" tag, so Larry never claims a TV.
//  - Team or player names come only from the group's own picks; a player is never paired with a team
//    in copy unless the fixture names them.

import type { MatchDay } from "./types/signals-ui";
import type { Domain, TasteItem } from "./types";

export type Sport = "cricket" | "football";

/** One sourced fixture. Every field shown on a ticket comes from here. */
export interface Fixture {
  league: string;
  sport: Sport;
  home: string;
  away: string;
  /** Qloo entity ids of the two teams (from resolveTeam), so picks match by id, not by name. */
  homeEntityId: string;
  awayEntityId: string;
  /** ISO time WITH an offset, e.g. "2026-11-07T19:30:00+05:30". */
  kickoffISO: string;
  /** IANA zone of the venue city, e.g. "Asia/Kolkata". */
  tz: string;
  city?: string;
  sourceName: string;
  /** https only. */
  sourceUrl: string;
  /** When the fixture was checked, ISO date. */
  fetchedAt: string;
}

/**
 * Hand-verified fixtures only. Left EMPTY on purpose: no fixture inside the window was checked by hand
 * before the demo (IPL is off-season on 31 Oct), so every Match Day answer is the honest fallback.
 * To add one: copy it from the league's official schedule, fill every field, and run the tests.
 */
export const FIXTURES: readonly Fixture[] = [];

/** Only fixtures this many days ahead. */
export const FIXTURE_WINDOW_DAYS = 7;
/** How long a match runs, in minutes (T20 about 3.5 h with the break; football 2 h with half-time). */
export const MATCH_MINUTES: Record<Sport, number> = { cricket: 210, football: 120 };
/** The match must END by this local time ("ending by about 10 pm", with a half-hour of slack). */
export const LATEST_END_MIN = 22 * 60 + 30;
/** And start no earlier than this local time. */
export const EARLIEST_START_MIN = 9 * 60;

export type FixtureCheck =
  | { ok: true }
  | { ok: false; reason: "unsourced" | "bad-time" | "past" | "too-far" | "too-late" | "too-early" };

/** Minutes after local midnight, in the fixture's own zone. */
function localMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return n("hour") * 60 + n("minute");
}

/** The local calendar day, so a match that runs past midnight is caught. */
function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a fixture may be put on a ticket now: sourced (name + https link + checked date), a real
 * time with an offset, in the future, within FIXTURE_WINDOW_DAYS, starting after 9 am and ending by
 * about 10:30 pm local time on the same day.
 */
export function validFixture(f: Fixture, now: Date = new Date()): FixtureCheck {
  if (!f.sourceName?.trim() || !/^https:\/\/\S+$/.test(f.sourceUrl ?? "") || !f.fetchedAt || !f.homeEntityId || !f.awayEntityId) {
    return { ok: false, reason: "unsourced" };
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(f.kickoffISO) || !validZone(f.tz)) return { ok: false, reason: "bad-time" };
  const start = new Date(f.kickoffISO);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "bad-time" };
  if (start.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (start.getTime() - now.getTime() > FIXTURE_WINDOW_DAYS * 864e5) return { ok: false, reason: "too-far" };
  const end = new Date(start.getTime() + MATCH_MINUTES[f.sport] * 60_000);
  if (localMinutes(start, f.tz) < EARLIEST_START_MIN) return { ok: false, reason: "too-early" };
  if (localDay(end, f.tz) !== localDay(start, f.tz) || localMinutes(end, f.tz) > LATEST_END_MIN) return { ok: false, reason: "too-late" };
  return { ok: true };
}

/** The soonest valid fixture for any of these Qloo team ids, or undefined (then: no date, ever). */
export function nextFixture(teamIds: readonly string[], now: Date = new Date(), fixtures: readonly Fixture[] = FIXTURES): Fixture | undefined {
  const ids = new Set(teamIds);
  return fixtures
    .filter((f) => (ids.has(f.homeEntityId) || ids.has(f.awayEntityId)) && validFixture(f, now).ok)
    .sort((a, b) => Date.parse(a.kickoffISO) - Date.parse(b.kickoffISO))[0];
}

/** "Sat 7:30pm" in the fixture's own zone. Only from the fixture's time. */
export function fixtureWhen(f: Pick<Fixture, "kickoffISO" | "tz">): string {
  const d = new Date(f.kickoffISO);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: f.tz, weekday: "short" }).format(d);
  const mins = localMinutes(d, f.tz);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** The ticket's fixture line: "Mumbai Indians v Chennai Super Kings, Sat 7:30pm. Fixture: IPL (iplt20.com)." */
export function fixtureLine(f: Fixture): string {
  return `${f.home} v ${f.away}, ${fixtureWhen(f)}. Fixture: ${f.sourceName}.`;
}

/** The contract shape for 2D's /matchday and /api/matchday: only valid, sourced fixtures, else []. */
export function getMatchDay(entityIds: readonly string[], now: Date = new Date(), fixtures: readonly Fixture[] = FIXTURES): MatchDay[] {
  const out: MatchDay[] = [];
  for (const id of new Set(entityIds)) {
    const f = nextFixture([id], now, fixtures);
    if (!f) continue;
    out.push({
      team: f.homeEntityId === id ? f.home : f.away,
      league: f.league,
      fixture: { teams: `${f.home} v ${f.away}`, when: fixtureWhen(f) },
      source: f.sourceName,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- resolving a team or player */

/** The Qloo search the caller passes in (src/lib/qloo.ts searchEntities: it always sends `types=`). */
export type TeamSearch = (query: string, domain: Domain, take?: number) => Promise<TasteItem[]>;

/** Lower case, accents and punctuation off, "FC"/"CF"/"the" ignored: "Mumbai Indians" = "mumbai indians". */
export function teamKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\b(?:the|fc|cf|afc|sc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A team (or player) as a Qloo entity, by exact name only. The search is typed (brand + the sports
 * organisation tag, or person + athlete), because an untyped "Mumbai Indians" also returned the
 * Cleveland Guardians and Mumbai City FC. A namesake is never accepted: no exact match, no team.
 */
export async function resolveTeam(name: string, search: TeamSearch, kind: "team" | "player" = "team"): Promise<TasteItem | null> {
  const want = teamKey(name);
  if (!want) return null;
  const domain: Domain = kind === "team" ? "sports_team" : "athlete";
  const results = await search(name.trim().slice(0, 80), domain, 5);
  return results.find((r) => r.domain === domain && teamKey(r.name) === want) ?? null;
}

/* ---------------------------------------------------------------- the group opener line (for 2B) */

export interface MatchDayMember {
  name: string;
  items: readonly TasteItem[];
}

export interface MatchDayLine {
  /** Larry's line for the group's opening message (one sentence or two, well under 90 words). */
  line: string;
  /** The same in plain words. */
  plain: string;
  /** The shared team or player, from the members' own picks. */
  entity: TasteItem;
  /** Who picked it. */
  fans: string[];
  /** "shared": 2+ members picked it. "one-fan": one fan and a valid fixture: the group chooses. */
  kind: "shared" | "one-fan";
  /** Only when a hand-verified fixture is valid. Never invented. */
  fixture?: Fixture;
}

const SPORTS: ReadonlySet<Domain> = new Set<Domain>(["sports_team", "athlete"]);

function names(list: string[]): string {
  return list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/**
 * The single Match Day line for a group's opening message (priority: Match Day > shared item >
 * "Dig deeper"). Leads only when 2+ members picked the same team or player entity; with one fan it
 * appears only when that fan's team has a valid, sourced fixture, and then the group chooses
 * ("Watch-along, or a normal plan?"). Zero fans: null. Non-fans are always offered a normal plan.
 */
export function matchDayLine(members: readonly MatchDayMember[], opts: { now?: Date; fixtures?: readonly Fixture[] } = {}): MatchDayLine | null {
  const now = opts.now ?? new Date();
  const fixtures = opts.fixtures ?? FIXTURES;
  const byId = new Map<string, { item: TasteItem; fans: string[] }>();
  for (const m of members) {
    for (const item of m.items) {
      if (!SPORTS.has(item.domain)) continue;
      const e = byId.get(item.id) ?? { item, fans: [] };
      if (!e.fans.includes(m.name)) e.fans.push(m.name);
      byId.set(item.id, e);
    }
  }
  if (!byId.size) return null;
  const ranked = [...byId.values()].sort((a, b) => b.fans.length - a.fans.length || (a.item.domain === "sports_team" ? -1 : 1));
  const top = ranked[0];
  const others = members.map((m) => m.name).filter((n) => !top.fans.includes(n));
  // A fixture only for a team the fixture file names by id (players have none).
  const fixture = top.item.domain === "sports_team" ? nextFixture([top.item.id], now, fixtures) : undefined;

  if (top.fans.length >= 2) {
    const both = top.fans.length === 2 ? "both" : "all";
    const lead = `${names(top.fans)} ${both} picked ${top.item.name}. Bold.`;
    const when = fixture ? ` ${fixtureLine(fixture)}` : "";
    const rest = others.length ? ` ${names(others)}, you get a vote: watch-along, or a normal plan?` : "";
    return {
      line: `${lead}${when}${rest}`,
      plain: `${names(top.fans)} ${both} like ${top.item.name}.${fixture ? ` They play ${fixtureWhen(fixture)}.` : ""}`,
      entity: top.item,
      fans: top.fans,
      kind: "shared",
      ...(fixture ? { fixture } : {}),
    };
  }
  if (!fixture) return null;
  const fan = top.fans[0];
  return {
    line: `${fan}'s team plays ${fixtureWhen(fixture)}. Watch-along, or a normal plan? Nobody's getting dragged to ${fixture.sport}. Fixture: ${fixture.sourceName}.`,
    plain: `${top.item.name} play ${fixtureWhen(fixture)}. You can watch together, or make a normal plan.`,
    entity: top.item,
    fans: top.fans,
    kind: "one-fan",
    fixture,
  };
}

/* ---------------------------------------------------------------- honest fallback copy */

/**
 * When there is no valid fixture (off-season, or outside the window): say so, then one labelled
 * fallback. "Larry won't make one up" is the promise.
 */
export function matchDayFallback(team?: string): { line: string; plain: string } {
  const who = team ? `${team} game` : "game";
  return {
    line: `No ${who} I can vouch for this week, and I won't make one up. Classic-match night at a calm café instead?`,
    plain: `There is no ${who} with a checked date this week. Watch an old match together at a calm café instead.`,
  };
}

/** The screen line on every Match Day ticket: Larry never claims a TV. */
export const SCREEN_LINE = "Larry can't promise a TV. Ask: 'Could you put the match on?' If not, take the window seat and share one phone.";
/** Plan B on a dated Match Day ticket. */
export const HIGHLIGHTS_PLAN_B = "Plan B: watch the highlights together the next day, somewhere calm.";
