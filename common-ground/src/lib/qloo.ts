import "server-only";
import {
  type GroupBridge,
  type GroupGround,
  type GroupMember,
  type Persona,
  type PlaceCard,
  type PlaceFit,
  type PlaceVibe,
  ROOM_MAX_MEMBERS,
} from "./contracts";
import { RECENT_PLACES_MAX } from "./chat-protocol";
import { safeImage } from "./schemas";
import { type Mood, type RequestSignals, LESS_KNOWN_MAX, QLOO_AGE_MAP } from "./types/signals";
import { type Charge, curateBridges, judgePlaceFits } from "./suggest";
import {
  type Bridge,
  type CommonGround,
  type Domain,
  type Profile,
  type TasteItem,
  DOMAINS,
  DOMAIN_KEYS,
  domainFromUrn,
  domainTags,
} from "./types";

const BASE = (process.env.QLOO_SERVER_URL ?? "https://hackathon.api.qloo.com").replace(/\/$/, "");

/**
 * Low-pressure places for a first meetup, queried per group so cafés don't crowd out the rest.
 * Tag IDs come from Qloo's /v2/tags (all verified to return places).
 */
const HANGOUT_GROUPS: { label: string; tags: string[] }[] = [
  { label: "games", tags: ["urn:tag:category:place:board_game_club", "urn:tag:category:place:video_arcade", "urn:tag:category:place:game_store"] },
  { label: "books", tags: ["urn:tag:category:place:book_store", "urn:tag:category:place:comic_book_store"] },
  { label: "library", tags: ["urn:tag:category:place:library", "urn:tag:category:place:public_library"] },
  { label: "cafe", tags: ["urn:tag:category:place:cafe", "urn:tag:category:place:tea_house", "urn:tag:category:place:art_cafe"] },
];
/**
 * Anxiety-friendliness, lowest tier first (ideas section 3, #2): a structured activity gives two
 * people something to do while they talk (the trivia-league RCT), then a quiet free space, then
 * browsing, then just sitting with a drink. Places are ranked by tier; Qloo's affinity only orders
 * places within a tier.
 */
const CALM_TIER: Record<string, number> = {
  board_game_club: 0,
  video_arcade: 0,
  library: 1,
  public_library: 1,
  game_store: 2,
  book_store: 2,
  comic_book_store: 2,
  tea_house: 3,
  art_cafe: 3,
  cafe: 3,
  coffee_shop: 3,
  coffee_store: 3,
};
/** Groups in the same order: games, then library, then books, then cafés. */
const GROUP_TIER: Record<string, number> = { games: 0, library: 1, books: 2, cafe: 3 };
/** Category tags that make a place a good hangout on their own. */
const STRONG_HANGOUT = new Set([
  "board_game_club", "video_arcade", "game_store", "book_store", "comic_book_store", "library", "public_library",
]);
const HANGOUT = new Set([...STRONG_HANGOUT, "cafe", "coffee_shop", "coffee_store", "tea_house", "art_cafe"]);
/** Never suggested: not open to the public, or built around alcohol. */
const NEVER = new Set(["college", "university", "school", "hostel", "sports_bar", "night_club", "hookah_bar"]);
/** Fine only when the place is also a strong hangout (e.g. an arcade with a bar). */
const DRINKING = new Set(["bar", "pub", "cocktail_bar", "wine_bar", "lounge", "brewery", "beer_garden", "fine_dining_restaurant"]);
/** What kind of place it is and why it's low-pressure, in easy-read words. First match wins. */
const KINDS: [string[], string][] = [
  [["board_game_club"], "A board-game café. You play, so it's easy to talk."],
  [["video_arcade"], "An arcade. You play, so it's easy to talk."],
  [["game_store"], "A game shop. Easy to browse together."],
  [["comic_book_store"], "A comic shop. Easy to browse together."],
  [["book_store"], "A bookshop. Easy to browse together."],
  [["library", "public_library"], "A library. Quiet, and free to go in."],
  [["tea_house"], "A tea house. Easy to sit and talk."],
  [["cafe", "coffee_shop", "coffee_store", "art_cafe"], "A café. Easy to sit and talk."],
];
/**
 * Qloo's own place tags about how a place feels (ambience, noise level, setting). Quiet, cosy
 * places come first inside a tier; lively, bustling or megastore places go after the calm ones.
 */
const QUIET_TAG = /^urn:tag:(?:ambience:qloo:(?:quiet|cozy|cosy|calm|relaxed|relaxing|peaceful|tranquil|serene|laid_back|intimate|low_key|chill)|noise_level:qloo:(?:quiet|low))$/;
const BUSY_TAG = /^urn:tag:(?:ambience:qloo:(?:lively|loud|noisy|bustling|energetic|vibrant|crowded|party|rowdy|high_energy)|noise_level:qloo:(?:loud|high|very_loud)|neighborhood_characteristic:qloo:(?:bustling|touristy|touristic)|setting:qloo:megastore)$/;
/** Big chains are fine, but a local place makes a better first plan, so they go last. */
const CHAIN = /\b(starbucks|costa coffee|caf[eé] coffee day|ccd|mcdonald'?s|kfc|domino'?s|pizza hut|subway|dunkin'?|tim hortons|burger king|third wave coffee|barista coffee|chaayos|pret|caff[eè] nero|blue tokai)\b/i;

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Qloo's opening hours for one day: "T09:00:00"-style times, or closed. */
export interface QlooHoursSpan {
  opens?: string;
  closes?: string;
  closed?: boolean;
}

export interface QlooEntity {
  entity_id: string;
  name: string;
  types?: string[];
  subtype?: string;
  /** Qloo's popularity percentile, 0-1 (insights and /entities return it). */
  popularity?: number;
  properties?: {
    image?: { url?: string };
    address?: string;
    /** weekday name ("monday") -> spans. */
    hours?: Record<string, QlooHoursSpan[] | null> | null;
    is_closed?: boolean;
    short_description?: string;
    description?: string;
    ambience_description?: string;
    keywords?: { name?: string; count?: number }[] | null;
  };
  /** Insights results use `id`; search results use `tag_id`. */
  tags?: { id?: string; tag_id?: string; name?: string }[];
  location?: { lat: number; lon: number };
  query?: {
    affinity?: number;
    distance?: number;
    explainability?: { "signal.interests.entities"?: { entity_id: string; score: number }[] };
  };
}

async function qloo(path: string, params: Record<string, string | number | boolean>) {
  const key = process.env.QLOO_KEY;
  if (!key) throw new QlooError("QLOO_KEY is not set", 500);

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let res = await fetch(url, { headers: { "X-Api-Key": key }, cache: "no-store" });
  // Qloo's rate limit: wait a moment and try once more before giving up ("Qloo is busy").
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, retryWaitMs(res.headers.get("retry-after"))));
    res = await fetch(url, { headers: { "X-Api-Key": key }, cache: "no-store" });
  }
  const body = await res.json().catch(() => ({}));
  // Path and status only: Qloo's own error text can repeat the query (a person's coordinates or
  // search words), and this message ends up in the server log.
  if (!res.ok) throw new QlooError(`Qloo ${path} failed (${res.status})`, res.status);
  return body;
}

/** How long to wait before the one retry after a 429: Retry-After when it is short, else ~0.8s. */
function retryWaitMs(retryAfter: string | null): number {
  const fallback = Number(process.env.QLOO_RETRY_MS ?? 800);
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs > 0 && secs <= 3) return secs * 1000;
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 800;
}

const tagIds = (e: QlooEntity) => (e.tags ?? []).map((t) => t.id ?? t.tag_id ?? "");

/**
 * Sportspeople: Qloo's athlete tag, or a sports occupation. Live (2026-10-30), Virat Kohli is
 * tagged actor + occupation:cricketer, not athlete, so the tag alone would lose him.
 */
const SPORT_OCCUPATION =
  /^urn:tag:occupation:(?:person|wikidata):[\w]*(?:cricketer|footballer|player|athlete|swimmer|boxer|wrestler|runner|cyclist|golfer|racing_driver|skater|gymnast|sprinter|jockey|tennis|batsman|bowler|olympian|sportsperson|martial_artist)/;
function isAthlete(e: QlooEntity): boolean {
  return tagIds(e).some((id) => id === "urn:tag:genre:person:athlete" || SPORT_OCCUPATION.test(id));
}
const isSportsOrg = (e: QlooEntity) => tagIds(e).some((id) => id.startsWith("urn:tag:genre:brand:sports_organization"));

/**
 * The app domain of a Qloo entity. Brands and people are split by their tags (sports teams and
 * players), and `prefer` (the domain searched or queried) wins when it fits the type.
 */
export function entityDomain(e: QlooEntity, prefer?: Domain): Domain | undefined {
  for (const urn of e.types ?? []) {
    if (prefer && DOMAINS[prefer].urn === urn) return prefer;
    if (urn === DOMAINS.brand.urn) return isSportsOrg(e) ? "sports_team" : "brand";
    if (urn === DOMAINS.person.urn) return isAthlete(e) ? "athlete" : "person";
    const d = domainFromUrn(urn, prefer);
    if (d) return d;
  }
  return undefined;
}

/** Whether an entity belongs in a domain that needs tags (sports teams, players). */
function fitsDomain(e: QlooEntity, domain: Domain): boolean {
  if (domain === "athlete") return isAthlete(e);
  if (domain === "sports_team") return isSportsOrg(e);
  return true;
}

function toItem(e: QlooEntity, fallback: Domain): TasteItem {
  const domain = entityDomain(e, fallback) ?? fallback;
  // Only images a later request will accept (https, short) and next/image may load (Qloo's own host,
  // remotePatterns in next.config.ts), so an added pick never breaks validation or a tile.
  return { id: e.entity_id, name: e.name, domain, image: qlooImage(e.properties?.image?.url) };
}

/** Every distinct Qloo type, for a search across all domains. */
const ALL_TYPES = [...new Set(DOMAIN_KEYS.map((d) => DOMAINS[d].urn))].join(",");

/**
 * Search entities by name. Used for picture tiles and to resolve names the agent hears. `types` is
 * always sent (names collide across types: "Ohtani" finds a documentary). Sports teams and players
 * share a type with brands and people, so those results are checked by tag.
 */
export async function searchEntities(query: string, domain?: Domain, take = 8): Promise<TasteItem[]> {
  const types = domain ? DOMAINS[domain].urn : ALL_TYPES;
  const tagged = !!domain && domainTags(domain).length > 0;
  const body = await qloo("/search", { query, types, take: tagged ? Math.min(take * 3, 30) : take });
  const results: QlooEntity[] = body.results ?? [];
  return results
    .filter((e) => !domain || fitsDomain(e, domain))
    .slice(0, take)
    .map((e) => toItem(e, domain ?? entityDomain(e) ?? "movie"));
}

// ---------------------------------------------------------------- the person's signals (mood, age, Hidden Gems)

/** Extra Qloo parameters from a person's signals (see signalParams). */
export type QlooExtra = Record<string, string | number>;

/**
 * Hidden Gems: Qloo's popularity is a percentile (0-1), and most well-known picks sit above 0.95.
 * Below 0.9 is the long tail people haven't all heard of yet. One number for the whole app (P3).
 */
export const HIDDEN_GEMS_MAX = LESS_KNOWN_MAX;
export { LESS_KNOWN_MAX };
/** Curious mood: a gentler lean to the long tail than the Hidden Gems switch. */
export const CURIOUS_MAX = 0.95;
/** Hype: the big, buzzy picks everyone is talking about. */
export const HYPE_MIN = 0.9;

/**
 * Mood-style Qloo tags for films, shows, books and games (ids checked live with /v2/tags, 30 Oct
 * 2026). Sent as `signal.interests.tags`, so they lean the ranking without filtering anything out.
 */
export const MOOD_MEDIA_TAGS: Record<Mood, string[]> = {
  chill: ["urn:tag:style:qloo:cozy", "urn:tag:plot:qloo:feel_good"],
  "low-energy": ["urn:tag:style:qloo:cozy", "urn:tag:plot:qloo:feel_good"],
  social: ["urn:tag:plot:qloo:feel_good", "urn:tag:audience:qloo:feel_good"],
  hype: ["urn:tag:style:qloo:intense", "urn:tag:plot:qloo:intense"],
  curious: [],
};

/** Where a mood moves the place vibe: Chill and Low energy towards calm, Social and Hype towards lively. */
export function moodVibes(mood: Mood | undefined): PlaceVibe[] | undefined {
  switch (mood) {
    case "chill":
    case "low-energy":
      return ["calm", "cosy", "lively"];
    case "social":
    case "hype":
      return ["lively", "cosy", "calm"];
    default:
      return undefined;
  }
}

/**
 * The Qloo parameters for one person's signals:
 * - Hidden Gems -> `filter.popularity.max` (HIDDEN_GEMS_MAX). Curious mood -> a softer max (long tail).
 * - Hype (without Hidden Gems) -> `filter.popularity.min` for media.
 * - Age range -> `signal.demographics.age` through QLOO_AGE_MAP (only the coarse bucket, never a birthday).
 * - Mood -> mood-style `signal.interests.tags` for media. For places, mood moves the vibe order
 *   instead (moodVibes), since Qloo's place ambience tags are thin in India.
 * Nothing here is ever shown to anyone: it only shapes what Qloo returns for this person.
 */
export function signalParams(signals: RequestSignals | undefined, target: "media" | "place"): QlooExtra {
  if (!signals) return {};
  const out: QlooExtra = {};
  if (signals.hiddenGems) out["filter.popularity.max"] = HIDDEN_GEMS_MAX;
  else if (signals.mood === "curious") out["filter.popularity.max"] = CURIOUS_MAX;
  else if (signals.mood === "hype" && target === "media") out["filter.popularity.min"] = HYPE_MIN;
  if (signals.ageBucket && QLOO_AGE_MAP[signals.ageBucket]) out["signal.demographics.age"] = QLOO_AGE_MAP[signals.ageBucket];
  const tags = target === "media" && signals.mood ? MOOD_MEDIA_TAGS[signals.mood] : [];
  if (tags.length) out["signal.interests.tags"] = tags.join(",");
  return out;
}

/** What one insights call really did: the results, the extra filters Qloo applied, and whether it fell back. */
export interface InsightsResult {
  entities: QlooEntity[];
  /** The person's extra parameters that the returned results were found WITH. Empty after a fallback. */
  appliedFilters: QlooExtra;
  /** True when Qloo refused the extras (400) or they left nothing, so the call ran again without them. */
  fellBack: boolean;
}

/**
 * One insights call with the person's extra parameters. Signals only lean the results: if Qloo
 * refuses them (400) or they leave nothing (a narrow domain under Hidden Gems), the same call is
 * made once without them, so a mood never empties a board. The answer says which happened, so a
 * "hidden gem" or "less known" label is only ever shown when the filter was really applied (P2).
 */
export async function insightsCall(params: Record<string, string | number | boolean>, extra: QlooExtra = {}): Promise<InsightsResult> {
  const plain = async (fellBack: boolean): Promise<InsightsResult> => ({
    entities: ((await qloo("/v2/insights", params)).results?.entities ?? []) as QlooEntity[],
    appliedFilters: {},
    fellBack,
  });
  if (!Object.keys(extra).length) return plain(false);
  try {
    const leaned = ((await qloo("/v2/insights", { ...params, ...extra })).results?.entities ?? []) as QlooEntity[];
    if (leaned.length) return { entities: leaned, appliedFilters: { ...extra }, fellBack: false };
  } catch (err) {
    if (!(err instanceof QlooError) || err.status !== 400) throw err;
  }
  return plain(true);
}

/** Entities Qloo returned as less known WITH the popularity filter applied (see markLessKnown). */
const LESS_KNOWN = new WeakSet<QlooEntity>();

/**
 * True only when the filter that asks for less-known results was applied (max at or under
 * LESS_KNOWN_MAX, so Curious mood's softer 0.95 never counts) AND the returned popularity is under it.
 */
export function isLessKnownResult(e: Pick<QlooEntity, "popularity">, r: Pick<InsightsResult, "appliedFilters" | "fellBack">): boolean {
  const max = Number(r.appliedFilters["filter.popularity.max"]);
  return !r.fellBack && Number.isFinite(max) && max <= LESS_KNOWN_MAX && typeof e.popularity === "number" && e.popularity < LESS_KNOWN_MAX;
}

function markLessKnown(r: InsightsResult): QlooEntity[] {
  for (const e of r.entities) if (isLessKnownResult(e, r)) LESS_KNOWN.add(e);
  return r.entities;
}

/** `{ lessKnown: true }` for a result Qloo returned as less known under an applied filter, else nothing. */
const gemFlag = (e: QlooEntity): { lessKnown?: true } => (LESS_KNOWN.has(e) ? { lessKnown: true } : {});

async function insights(domain: Domain, signalIds: string[], take: number, extra: QlooExtra = {}): Promise<QlooEntity[]> {
  if (signalIds.length === 0) return [];
  const tags = domainTags(domain);
  const result = await insightsCall(
    {
      "filter.type": DOMAINS[domain].urn,
      ...(tags.length ? { "filter.tags": tags.join(",") } : {}),
      "signal.interests.entities": signalIds.join(","),
      "feature.explainability": true,
      take,
    },
    extra,
  );
  return markLessKnown(result);
}

/** The media every pair is asked about; other domains join when the people's picks call for them. */
const CORE_DOMAINS: Domain[] = ["movie", "tv_show", "artist", "videogame", "book"];
/**
 * Domains that only make a good bridge when at least two people picked in them. A sports pick
 * alone gives lopsided "athletes you'd both like" (credit splits ~0.58/0.42 to the fan), so it
 * works as a signal for films, shows and games instead.
 */
const NEEDS_TWO: ReadonlySet<Domain> = new Set<Domain>(["sports_team", "athlete", "brand", "person", "destination"]);
const DEFAULT_DOMAINS_MAX = 8;

/**
 * The domains to ask Qloo about for these people: the five core media and podcasts, plus sports,
 * brands, people or travel when at least two people picked something there. At most 8, so a pair
 * makes at most 16 calls (two per domain).
 */
export function defaultDomains(profiles: Profile[]): Domain[] {
  const pickers = new Map<Domain, number>();
  for (const p of profiles) for (const d of new Set(p.items.map((i) => i.domain))) pickers.set(d, (pickers.get(d) ?? 0) + 1);
  const extra = DOMAIN_KEYS.filter((d) => !CORE_DOMAINS.includes(d) && (pickers.get(d) ?? 0) >= (NEEDS_TWO.has(d) ? 2 : 1))
    .sort((x, y) => (pickers.get(y) ?? 0) - (pickers.get(x) ?? 0));
  const out = [...CORE_DOMAINS, ...extra];
  if (!out.includes("podcast")) out.push("podcast");
  return out.slice(0, DEFAULT_DOMAINS_MAX);
}

/** Recommendations for one person in one domain, excluding what they already picked or dislike. */
export async function recommendFor(
  profile: Profile,
  domain: Domain,
  take = 5,
  opts: { exclude?: { id?: string; name: string }[]; signals?: RequestSignals } = {},
): Promise<Bridge[]> {
  const picked = new Set(profile.items.map((i) => i.id));
  const names = new Map(profile.items.map((i) => [i.id, i.name]));
  const banIds = new Set((opts.exclude ?? []).map((x) => x.id).filter(Boolean));
  const banNames = new Set((opts.exclude ?? []).map((x) => x.name.toLowerCase()));
  const results = await insights(domain, [...picked], take + picked.size + banIds.size, signalParams(opts.signals, "media"));
  return results
    .filter((e) => !picked.has(e.entity_id) && !banIds.has(e.entity_id) && !banNames.has(e.name.toLowerCase()))
    .slice(0, take)
    .map((e) => ({
      ...toItem(e, domain),
      ...gemFlag(e),
      affinity: e.query?.affinity ?? 0,
      fromA: contributors(e).slice(0, 2).map((id) => names.get(id)).filter((n): n is string => !!n),
      fromB: [],
    }));
}

/** Signal entities that drove a result, strongest first. */
function contributors(e: QlooEntity): string[] {
  return scoredContributors(e).map((c) => c.entity_id);
}

function scoredContributors(e: QlooEntity): { entity_id: string; score: number }[] {
  return (e.query?.explainability?.["signal.interests.entities"] ?? [])
    .filter((c) => c.score > 0)
    .sort((x, y) => y.score - x.score);
}

// Franchise matching: "Spider-Man: Far from Home" and "Spider-Man: Into the Spider-Verse",
// or Percy Jackson sequels, count as one thing so the list doesn't repeat itself.
const STOP = /^(the|a|an)\s+/;
function franchiseKeys(name: string): { main: string; full: string; series?: string } {
  const lower = name.toLowerCase().replace(/[’']/g, "'");
  const series = lower.match(/\(([^)#,]+)/)?.[1]?.replace(STOP, "").trim();
  const full = lower.replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim().replace(STOP, "");
  const main = lower
    .split(/:| - | – |\(/)[0]
    .replace(/\b(\d+|ii|iii|iv|v|vi)\s*$/, "")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(STOP, "");
  return { main, full, series: series && series.length >= 6 ? series : undefined };
}

function sameFranchise(x: string, y: string): boolean {
  const a = franchiseKeys(x);
  const b = franchiseKeys(y);
  if (a.main && a.main === b.main) return true;
  if (a.series && (a.series === b.series || a.series === b.main || a.series.startsWith(b.main + " "))) return true;
  if (b.series && (b.series === a.main || b.series.startsWith(a.main + " "))) return true;
  // A long, distinctive shared start ("to all the boys", "percy jackson").
  const prefix = (short: string, long: string) =>
    short.length >= 10 && short.includes(" ") && (long === short || long.startsWith(short + " "));
  return prefix(a.main, b.full) || prefix(b.main, a.full) || commonWords(a.full, b.full) >= 12;
}

/** Length of the shared leading words of two names, in characters. */
function commonWords(x: string, y: string): number {
  const a = x.split(" ");
  const b = y.split(" ");
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= 2 ? a.slice(0, n).join(" ").length : 0;
}

/**
 * A pick's contribution only means something above an even share of the signal. Qloo's
 * explainability scores sum to about 1 across the signal, so with 7 picks an even share is ~0.14.
 * Calibrated on live data (2026-10-29): clear bridges sit at 0.17-0.23, noise at 0.13-0.16.
 * A one-pick signal has nothing to compare with, so any contribution counts.
 */
const CONTRIBUTION_RATIO = 1.2;
/**
 * In a one-person query the result is already that person's, so the credited pick only has to
 * carry at least an even share of their signal. Live data (2026-10-30, 4 picks each): top
 * per-person credits sit at 0.26-0.38, so the combined ratio (0.3) would drop real bridges.
 */
const PER_PERSON_RATIO = 1;
const thresholdFor = (signalSize: number, ratio = CONTRIBUTION_RATIO) => (signalSize > 1 ? ratio / signalSize : 0);

/** Results asked for per query. Two-signal bridges need overlap between two lists, so ask for
 * Qloo's most (take=100 is rejected). Live, 50 gives 3 shared music results and 16 games. */
const TAKE_COMBINED = 25;
const TAKE_PER_PERSON = 50;
const MAX_BRIDGES = 8;

interface Candidate {
  bridge: Bridge;
  /** Sort key within its tier, higher first. */
  rank: number;
  crossDomain: boolean;
}

type Scored = { entity_id: string; score: number };

/**
 * The strongest pick of each person, crediting two different picks: a "bridge" explained only
 * by the pick they both chose says nothing new. Undefined when that's all there is.
 */
function creditPair(forA: Scored[], forB: Scored[]): [Scored | undefined, Scored | undefined] | undefined {
  if (!(forA[0] && forB[0] && forA[0].entity_id === forB[0].entity_id)) return [forA[0], forB[0]];
  const options = [
    [forA[0], forB[1]],
    [forA[1], forB[0]],
  ].filter(([x, y]) => x && y) as [Scored, Scored][];
  if (!options.length) return undefined;
  return options.sort((p, q) => Math.min(q[0].score, q[1].score) - Math.min(p[0].score, p[1].score))[0];
}

/** Rejects only when every query failed, so one bad domain doesn't sink the rest. */
function throwIfAllFailed(settled: PromiseSettledResult<unknown>[]) {
  if (settled.length && settled.every((r) => r.status === "rejected")) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
}

/** Options for the Larry-curated step of common ground. */
export interface CurateOptions {
  /** false: no model call, Qloo's ranking only. Default: curate when a model key is set. */
  curate?: boolean;
  /** What each person dislikes and Larry's notes, keyed "a"/"b" (pair) or member id (group). */
  personas?: Record<string, Pick<Persona, "dislikes" | "notes"> | undefined>;
  /** Charges the model's cost to an access code, when the caller has one. */
  charge?: Charge;
  signal?: AbortSignal;
  /** The asker's own mood, age range and Hidden Gems (rooms: a blend, see blendSignals). Shapes Qloo only. */
  signals?: RequestSignals;
}

/** Candidates offered to Larry to choose from (about 20, then 6-8 are kept). */
const POOL_MAX = 20;
const POOL_PER_DOMAIN = 4;
/** At most this many candidates credited to one person's one pick, so one pick can't fill the pool. */
const POOL_PER_PICK = 5;

/**
 * The candidates Larry chooses from, built so each person's picks each get a say. Otherwise one
 * pick could drive most of the bridges. Here the candidates are taken round-robin by contributing pick (each person's pick in turn, best
 * candidate of each first), then filled by rank, with at most POOL_PER_PICK per pick and
 * POOL_PER_DOMAIN per domain (Qloo's own `board` may pass the domain cap). `credits` names the
 * picks behind a candidate as "person:pick".
 */
export function coveragePool<T extends { id: string; name: string; domain: Domain }>(ordered: T[], credits: (c: T) => string[], board: T[] = []): T[] {
  const pool: T[] = [];
  const perDomain = new Map<Domain, number>();
  const perPick = new Map<string, number>();
  const onBoard = new Set(board.map((b) => b.id));
  // Every pick behind any candidate, in order of its best candidate.
  const keys = [...new Set(ordered.flatMap(credits))];
  // The per-pick cap only binds people with 3+ picks behind the candidates: someone with one or
  // two picks can't have their taste spread wider than that.
  const personOf = (k: string) => k.slice(0, k.indexOf(":"));
  const spread = new Map<string, number>();
  for (const k of keys) spread.set(personOf(k), (spread.get(personOf(k)) ?? 0) + 1);
  const capped = (k: string) => (spread.get(personOf(k)) ?? 0) >= 3;
  const fits = (c: T) =>
    !pool.some((x) => x.id === c.id || sameFranchise(x.name, c.name)) &&
    // Qloo's own board (the fallback) may go past the per-domain cap; nothing else may.
    (onBoard.has(c.id) || (perDomain.get(c.domain) ?? 0) < POOL_PER_DOMAIN) &&
    credits(c).every((k) => !capped(k) || (perPick.get(k) ?? 0) < POOL_PER_PICK);
  const add = (c: T) => {
    pool.push(c);
    perDomain.set(c.domain, (perDomain.get(c.domain) ?? 0) + 1);
    for (const k of credits(c)) perPick.set(k, (perPick.get(k) ?? 0) + 1);
  };
  // Round-robin: each pick's best candidate that still fits, a few rounds.
  for (let round = 0; round < 3 && pool.length < POOL_MAX; round++) {
    let added = false;
    for (const k of keys) {
      if (pool.length >= POOL_MAX) break;
      const next = ordered.find((c) => credits(c).includes(k) && fits(c));
      if (next) {
        add(next);
        added = true;
      }
    }
    if (!added) break;
  }
  for (const c of ordered) {
    if (pool.length >= POOL_MAX) break;
    if (fits(c)) add(c);
  }
  return pool;
}
/** Qloo calls in flight at once for one pair (up to 16 per-person calls plus combined ones). */
const PAIR_CONCURRENCY = 4;

/** A plain reason from Qloo's credits, used when Larry's curated reason isn't available. */
export function plainWhy(credits: { name: string; pick?: string }[]): string {
  const named = credits.filter((c) => c.pick);
  if (!named.length) return "Larry found it from what people with your picks love.";
  if (named.length === 1) return `Fans of ${named[0].pick} rate it highly.`;
  const parts = named.slice(0, 3).map((c) => `${c.name} likes ${c.pick}`);
  const list = parts.length === 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${list}. Fans of ${named.length === 2 ? "both" : "all of those"} rate it.`;
}

/**
 * Find what two people have in common: Qloo finds the candidates, Larry picks the ones that fit.
 *
 * Two signals (the main method): per domain, Qloo is asked once with only A's picks and once
 * with only B's. A bridge is a result in BOTH lists, so each person's taste points to it on its
 * own. Explainability from each query names that person's strongest pick behind it, and the
 * bridge's affinity is the weaker of the two (min), so it must fit both people well.
 *
 * Combined signal (fallback): one query with both people's picks; a bridge is a result that both
 * people's picks clearly contributed to. Asked only for domains where two signals found fewer than
 * 2 bridges, and only while the board has room (live, films, TV and books rarely overlap). If
 * fewer than 4 bridges result, the best combined matches fill in, as before.
 *
 * Curation: up to 20 of those candidates go to one model call, which keeps
 * the 6-8 that really fit both people, drops mismatches, and writes a specific `why` grounded in
 * each person's picks. Only candidate ids can come back. If the model is off, out of budget or
 * fails, Qloo's ranking is used with a plainer `why`.
 */
export async function findCommonGround(a: Profile, b: Profile, domains?: Domain[], opts: CurateOptions = {}): Promise<CommonGround> {
  const { shared, chosen, pool } = await pairCandidates(a, b, domains?.length ? domains : defaultDomains([a, b]), signalParams(opts.signals, "media"));
  const withPlainWhy = (br: Bridge): Bridge => ({
    ...br,
    why: br.why ?? plainWhy([{ name: a.name, pick: br.fromA[0] }, { name: b.name, pick: br.fromB[0] }]),
  });
  const fallback = { shared, bridges: chosen.map(withPlainWhy) };
  if (opts.curate === false || pool.length < 3) return fallback;

  const curated = await curateBridges(
    {
      people: [
        { key: "a", name: a.name, picks: a.items.map((i) => i.name), ...personaHints(opts.personas?.a) },
        { key: "b", name: b.name, picks: b.items.map((i) => i.name), ...personaHints(opts.personas?.b) },
      ],
      candidates: pool.map((br) => ({
        id: br.id,
        name: br.name,
        domain: br.domain,
        credits: { a: br.fromA[0], b: br.fromB[0] },
      })),
    },
    { charge: opts.charge, signal: opts.signal },
  );
  if (!curated) return fallback;
  const byId = new Map(pool.map((br) => [br.id, br]));
  const bridges = curated.map((c) => ({ ...byId.get(c.id)!, why: c.why }));
  return { shared, bridges, curated: true };
}

/** A persona's dislikes and notes, short, for the curator. */
function personaHints(p?: Pick<Persona, "dislikes" | "notes">): { dislikes?: string[]; notes?: string[] } {
  if (!p) return {};
  return { dislikes: p.dislikes.slice(0, 15).map((d) => d.name), notes: p.notes.slice(0, 8) };
}

/**
 * Qloo's side of pair common ground: the deterministic board (`chosen`, at most 8, used as the
 * fallback) and a wider, varied pool (at most 20, at most 4 per domain) for Larry to choose from.
 */
async function pairCandidates(a: Profile, b: Profile, domains: Domain[], extra: QlooExtra = {}): Promise<{ shared: TasteItem[]; chosen: Bridge[]; pool: Bridge[] }> {
  const aIds = new Set(a.items.map((i) => i.id));
  const bIds = new Set(b.items.map((i) => i.id));
  const byId = new Map([...a.items, ...b.items].map((i) => [i.id, i]));
  const picks = [...byId.values()];
  const isPick = (id: string) => aIds.has(id) || bIds.has(id);
  const nameOf = (c?: Scored) => (c ? [byId.get(c.entity_id)!.name] : []);
  const isCross = (domain: Domain, ...cs: (Scored | undefined)[]) =>
    cs.every((c) => {
      const d = c ? byId.get(c.entity_id)?.domain : undefined;
      return !!d && d !== domain;
    });
  // Sequels and spin-offs of either person's picks never count.
  const fresh = (c: Candidate) => !picks.some((p) => sameFranchise(c.bridge.name, p.name));
  const limit = limiter(PAIR_CONCURRENCY);

  const shared = a.items.filter((i) => bIds.has(i.id));

  // ---- two signals: one query per person per domain, a few at a time
  const thresholdA = thresholdFor(aIds.size, PER_PERSON_RATIO);
  const thresholdB = thresholdFor(bIds.size, PER_PERSON_RATIO);
  const perPerson = await Promise.allSettled(
    domains.map((domain) =>
      Promise.all([limit(() => insights(domain, [...aIds], TAKE_PER_PERSON, extra)), limit(() => insights(domain, [...bIds], TAKE_PER_PERSON, extra))]),
    ),
  );

  const twoSignal: Candidate[] = [];
  perPerson.forEach((r, di) => {
    if (r.status !== "fulfilled") return;
    const domain = domains[di];
    const [listA, listB] = r.value;
    const inB = new Map(listB.map((e) => [e.entity_id, e]));
    for (const ea of listA) {
      const eb = inB.get(ea.entity_id);
      if (!eb || isPick(ea.entity_id)) continue;
      const forA = scoredContributors(ea).filter((c) => aIds.has(c.entity_id)).slice(0, 2);
      const forB = scoredContributors(eb).filter((c) => bIds.has(c.entity_id)).slice(0, 2);
      const pair = creditPair(forA, forB);
      if (!pair) continue;
      const [ca, cb] = pair;
      if (!ca || !cb || ca.score < thresholdA || cb.score < thresholdB) continue;
      const affinity = Math.min(ea.query?.affinity ?? 0, eb.query?.affinity ?? 0);
      const item = toItem(ea, domain);
      twoSignal.push({
        bridge: {
          ...item,
          image: item.image ?? qlooImage(eb.properties?.image?.url),
          ...gemFlag(ea),
          affinity,
          fromA: nameOf(ca),
          fromB: nameOf(cb),
          scoreA: round2(ca.score),
          scoreB: round2(cb.score),
        },
        // Ties (same affinity) go to the bridge both picks drove more evenly.
        rank: affinity + Math.min(ca.score, cb.score) * 1e-3,
        crossDomain: isCross(domain, ca, cb),
      });
    }
  });

  const chosen: Candidate[] = [];
  const perDomain = new Map<Domain, number>();
  const tryAdd = (c: Candidate, limitN = MAX_BRIDGES) => {
    if (chosen.length >= limitN) return false;
    const { domain, id, name } = c.bridge;
    if ((perDomain.get(domain) ?? 0) >= 2) return false;
    if (chosen.some((x) => x.bridge.id === id || sameFranchise(x.bridge.name, name))) return false;
    chosen.push(c);
    perDomain.set(domain, (perDomain.get(domain) ?? 0) + 1);
    return true;
  };
  const byRank = (x: Candidate, y: Candidate) => y.rank - x.rank;

  const strong = twoSignal.filter(fresh).sort(byRank);
  for (const c of strong) tryAdd(c);
  let rest: Candidate[] = [];

  // ---- fallback: the combined signal, for domains two signals left short (2 fit per domain)
  const short = domains.filter((d) => (perDomain.get(d) ?? 0) < 2);
  if (chosen.length < MAX_BRIDGES && short.length) {
    const combined = await combinedCandidates(short, aIds, bIds, byId, isPick, isCross, limit, extra);
    if (combined === null) throwIfAllFailed(perPerson);
    const balanced = (combined?.balanced ?? []).filter(fresh).sort(byRank);
    for (const c of balanced) tryAdd(c);
    strong.push(...balanced);
    rest = (combined?.rest ?? []).filter(fresh).sort((x, y) => y.bridge.affinity - x.bridge.affinity);
    // Still too few clearly driven by both people: fill with the best overall matches.
    if (chosen.length < 4) {
      for (const c of rest) tryAdd(c, Math.max(4, chosen.length));
    }
  }

  // Prefer at least one bridge that crosses domains (e.g. a game from a film and a band).
  if (chosen.length && !chosen.some((c) => c.crossDomain)) {
    const cross = strong.find(
      (c) => c.crossDomain && !chosen.includes(c) && !chosen.some((x) => x.bridge.id === c.bridge.id || sameFranchise(x.bridge.name, c.bridge.name)),
    );
    if (cross) {
      const sameDomain = chosen.filter((c) => c.bridge.domain === cross.bridge.domain);
      const drop = sameDomain.length >= 2 ? sameDomain.at(-1)! : chosen.length >= MAX_BRIDGES ? chosen.at(-1)! : undefined;
      if (drop) chosen.splice(chosen.indexOf(drop), 1);
      chosen.push(cross);
    }
  }

  // The pool: the board first, then the strongest of the rest, varied across domains. Only
  // results credited to both people are offered (a one-sided result can't be "common" ground).
  // Round-robin by each person's contributing pick, so every pick gets a say (see coveragePool).
  const ranked = [...chosen, ...strong, ...rest.filter((r) => r.bridge.fromA.length && r.bridge.fromB.length)].map((c) => c.bridge);
  const pool = coveragePool(
    ranked,
    (br) => [...br.fromA.slice(0, 1).map((n) => `a:${n}`), ...br.fromB.slice(0, 1).map((n) => `b:${n}`)],
    chosen.map((c) => c.bridge),
  );

  return { shared, chosen: spreadOut(chosen.map((c) => c.bridge)), pool };
}

/**
 * The combined-signal method: Qloo is queried with both people's picks as one signal, and
 * explainability says which picks drove each result. `balanced` results were clearly driven by
 * both people; `rest` are the other results. Null when every query failed.
 */
async function combinedCandidates(
  domains: Domain[],
  aIds: Set<string>,
  bIds: Set<string>,
  byId: Map<string, TasteItem>,
  isPick: (id: string) => boolean,
  isCross: (domain: Domain, ...cs: (Scored | undefined)[]) => boolean,
  limit: <T>(job: () => Promise<T>) => Promise<T>,
  extra: QlooExtra = {},
): Promise<{ balanced: Candidate[]; rest: Candidate[] } | null> {
  const signal = [...new Set([...aIds, ...bIds])];
  const threshold = thresholdFor(signal.length);
  const settled = await Promise.allSettled(domains.map((domain) => limit(() => insights(domain, signal, TAKE_COMBINED, extra))));
  if (settled.length && settled.every((r) => r.status === "rejected")) return null;

  const balanced: Candidate[] = [];
  const rest: Candidate[] = [];
  settled.forEach((r, di) => {
    if (r.status !== "fulfilled") return;
    const domain = domains[di];
    for (const e of r.value) {
      if (isPick(e.entity_id)) continue;
      const scored = scoredContributors(e);
      const pair = creditPair(
        scored.filter((c) => aIds.has(c.entity_id)).slice(0, 2),
        scored.filter((c) => bIds.has(c.entity_id)).slice(0, 2),
      );
      if (!pair) continue;
      const [ca, cb] = pair;
      const scoreA = ca?.score ?? 0;
      const scoreB = cb?.score ?? 0;
      const affinity = e.query?.affinity ?? 0;
      const c: Candidate = {
        bridge: {
          ...toItem(e, domain),
          ...gemFlag(e),
          affinity,
          fromA: ca ? [byId.get(ca.entity_id)!.name] : [],
          fromB: cb ? [byId.get(cb.entity_id)!.name] : [],
          scoreA: ca ? round2(scoreA) : undefined,
          scoreB: cb ? round2(scoreB) : undefined,
        },
        rank: Math.min(scoreA, scoreB) * affinity,
        crossDomain: isCross(domain, ca, cb),
      };
      (ca && cb && scoreA >= threshold && scoreB >= threshold ? balanced : rest).push(c);
    }
  });
  return { balanced, rest };
}

/**
 * Keep the ranking, but let domains and reason pairs take turns, so the first few on screen
 * (the rest sit behind "Show more") aren't all music or all "Sam likes X. Priya likes Y.".
 */
function spreadOut(bridges: Bridge[]): Bridge[] {
  const reasonOf = (b: Bridge) => `${b.fromA[0]}|${b.fromB[0]}`;
  const left = [...bridges];
  const out: Bridge[] = [];
  const domains = new Map<string, number>();
  const reasons = new Map<string, number>();
  while (left.length) {
    // Fewest repeats wins; ties go to the higher-ranked bridge (earlier in the list).
    const cost = (b: Bridge) => (domains.get(b.domain) ?? 0) + (reasons.get(reasonOf(b)) ?? 0);
    const next = left.reduce((best, b) => (cost(b) < cost(best) ? b : best));
    left.splice(left.indexOf(next), 1);
    out.push(next);
    domains.set(next.domain, (domains.get(next.domain) ?? 0) + 1);
    reasons.set(reasonOf(next), (reasons.get(reasonOf(next)) ?? 0) + 1);
  }
  return out;
}


// ---------------------------------------------------------------- group common ground (2-5 people)

/** Results asked for per member per domain; overlap between lists needs long lists (see TAKE_PER_PERSON). */
const GROUP_TAKE = 50;
const GROUP_MAX_BRIDGES = 8;
/** Qloo calls in flight at once for one group, so a 5-person room doesn't burst into the rate limit. */
const GROUP_CONCURRENCY = 4;
/**
 * Domains asked about: for 2-3 people the same as a pair (core media, podcasts, and sports or
 * other domains two of them picked in); for 4-5 people the three their picks cover most.
 */
export function groupDomains(members: GroupMember[], n?: number): Domain[] {
  if (n === undefined && members.length < 4) return defaultDomains(members.map((m) => m.profile));
  const count = new Map<Domain, number>();
  for (const m of members) for (const i of m.profile.items) count.set(i.domain, (count.get(i.domain) ?? 0) + 1);
  return [...DOMAIN_KEYS].sort((x, y) => (count.get(y) ?? 0) - (count.get(x) ?? 0)).slice(0, n ?? 3);
}

/** Runs at most `n` of the given async jobs at a time. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

interface GroupCandidate {
  bridge: GroupBridge;
  /** How many members' tastes point to it. */
  coverage: number;
  rank: number;
}

/**
 * Find what 2-5 people have in common.
 *
 * Per domain, Qloo is asked once per member with only that member's picks (explainability on);
 * identical pick sets share one call. A group bridge is a result in at least two members' lists,
 * each credited to that member's strongest pick behind it. Its affinity is the lowest of those
 * members' affinities, so it must fit each of them, and bridges that more members' tastes point to
 * come first. Sequels of anyone's picks and repeats of one franchise are dropped, at most a few
 * per domain are kept, and every member is credited in at least one bridge when the data allows.
 * Shared items are picks two or more members chose. Rejects only when every Qloo call failed.
 * Then, as for a pair, Larry curates up to 20 candidates down to the 6-8 that fit the group, with
 * a specific `why`; Qloo's ranking with a plainer `why` is the fallback.
 */
export async function findGroupCommonGround(members: GroupMember[], domains?: Domain[], opts: CurateOptions = {}): Promise<GroupGround> {
  const people = members.slice(0, ROOM_MAX_MEMBERS);
  const { shared, chosen, pool } = await groupCandidates(people, domains, signalParams(opts.signals, "media"));
  const nameOf = new Map(people.map((m) => [m.id, m.name]));
  const withPlainWhy = (br: GroupBridge): GroupBridge => ({
    ...br,
    why: br.why ?? plainWhy(Object.entries(br.from).map(([id, picks]) => ({ name: nameOf.get(id) ?? "Someone", pick: picks[0] }))),
  });
  const fallback = { shared, bridges: chosen.map(withPlainWhy) };
  if (opts.curate === false || pool.length < 3) return fallback;

  const withPicks = people.filter((m) => m.profile.items.length);
  const curated = await curateBridges(
    {
      people: withPicks.map((m) => ({ key: m.id, name: m.name, picks: m.profile.items.map((i) => i.name), ...personaHints(opts.personas?.[m.id]) })),
      candidates: pool.map((br) => ({
        id: br.id,
        name: br.name,
        domain: br.domain,
        credits: Object.fromEntries(Object.entries(br.from).map(([id, picks]) => [id, picks[0]])),
      })),
    },
    { charge: opts.charge, signal: opts.signal },
  );
  if (!curated) return fallback;
  const byId = new Map(pool.map((br) => [br.id, br]));
  return { shared, bridges: curated.map((c) => ({ ...byId.get(c.id)!, why: c.why })), curated: true };
}

/** Qloo's side of group common ground: the deterministic board (fallback) and a wider pool for Larry. */
async function groupCandidates(people: GroupMember[], domains?: Domain[], extra: QlooExtra = {}): Promise<{ shared: GroupGround["shared"]; chosen: GroupBridge[]; pool: GroupBridge[] }> {
  const picksOf = new Map(people.map((m) => [m.id, new Map(m.profile.items.map((i) => [i.id, i]))]));

  const pickers = new Map<string, { item: TasteItem; memberIds: string[] }>();
  for (const m of people) {
    for (const item of m.profile.items) {
      const entry = pickers.get(item.id) ?? { item, memberIds: [] };
      if (!entry.memberIds.includes(m.id)) entry.memberIds.push(m.id);
      pickers.set(item.id, entry);
    }
  }
  const shared = [...pickers.values()]
    .filter((e) => e.memberIds.length >= 2)
    .sort((x, y) => y.memberIds.length - x.memberIds.length);
  const picks = [...pickers.values()].map((e) => e.item);

  const withPicks = people.filter((m) => m.profile.items.length);
  if (withPicks.length < 2) return { shared, chosen: [], pool: [] };

  const doms = domains?.length ? domains : groupDomains(people);
  const limit = limiter(GROUP_CONCURRENCY);
  const cache = new Map<string, Promise<QlooEntity[]>>();
  const query = (domain: Domain, ids: string[]) => {
    const key = `${domain}|${[...ids].sort().join(",")}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = limit(() => insights(domain, ids, GROUP_TAKE, extra));
      cache.set(key, hit);
    }
    return hit;
  };
  const tasks = doms.flatMap((domain) => withPicks.map((m) => ({ domain, m })));
  const settled = await Promise.allSettled(tasks.map(({ domain, m }) => query(domain, [...picksOf.get(m.id)!.keys()])));
  throwIfAllFailed(settled);

  // entity -> which members' lists it is in, with that member's credits and affinity
  type Hit = { credits: Scored[]; affinity: number };
  const found = new Map<string, { entity: QlooEntity; domain: Domain; hits: Map<string, Hit> }>();
  settled.forEach((r, ti) => {
    if (r.status !== "fulfilled") return;
    const { domain, m } = tasks[ti];
    const mine = picksOf.get(m.id)!;
    for (const e of r.value) {
      if (pickers.has(e.entity_id)) continue;
      const entry = found.get(e.entity_id) ?? { entity: e, domain, hits: new Map<string, Hit>() };
      entry.hits.set(m.id, {
        credits: scoredContributors(e).filter((c) => mine.has(c.entity_id)).slice(0, 2),
        affinity: e.query?.affinity ?? 0,
      });
      found.set(e.entity_id, entry);
    }
  });

  const threshold = (memberId: string) => thresholdFor(picksOf.get(memberId)!.size, PER_PERSON_RATIO);
  const candidates = (strict: boolean): GroupCandidate[] => {
    const out: GroupCandidate[] = [];
    for (const { entity, domain, hits } of found.values()) {
      const contributing = [...hits]
        .map(([memberId, h]) => ({ memberId, affinity: h.affinity, credits: h.credits.filter((c) => c.score >= (strict ? threshold(memberId) : 0)) }))
        .filter((x) => x.credits.length);
      if (contributing.length < 2) continue;
      const tops = contributing.map((x) => x.credits[0]);
      // Explained only by one pick everybody chose: says nothing new, unless a runner-up helps.
      if (new Set(tops.map((t) => t.entity_id)).size === 1) {
        const alt = contributing
          .map((x, i) => ({ i, c: x.credits[1] }))
          .filter((a): a is { i: number; c: Scored } => !!a.c)
          .sort((p, q) => q.c.score - p.c.score)[0];
        if (!alt) continue;
        tops[alt.i] = alt.c;
      }
      const affinity = Math.min(...contributing.map((x) => x.affinity));
      const from: Record<string, string[]> = {};
      contributing.forEach((x, i) => (from[x.memberId] = [picksOf.get(x.memberId)!.get(tops[i].entity_id)!.name]));
      const { id, name, image } = toItem(entity, domain);
      out.push({
        bridge: { id, name, domain, image, ...gemFlag(entity), affinity: round2(affinity), from },
        coverage: contributing.length,
        // More members first; then the weakest fit; then the most even credit.
        rank: contributing.length + affinity + Math.min(...tops.map((t) => t.score)) * 1e-3,
      });
    }
    return out
      .filter((c) => !picks.some((p) => sameFranchise(c.bridge.name, p.name)))
      .sort((x, y) => y.rank - x.rank);
  };

  const perDomainMax = Math.max(2, Math.ceil(GROUP_MAX_BRIDGES / doms.length));
  const chosen: GroupCandidate[] = [];
  const clashes = (c: GroupCandidate, list = chosen) =>
    list.some((x) => x.bridge.id === c.bridge.id || sameFranchise(x.bridge.name, c.bridge.name));
  const tryAdd = (c: GroupCandidate) => {
    if (chosen.length >= GROUP_MAX_BRIDGES || clashes(c)) return;
    if (chosen.filter((x) => x.bridge.domain === c.bridge.domain).length >= perDomainMax) return;
    chosen.push(c);
  };
  const strict = candidates(true);
  strict.forEach(tryAdd);
  // Too few clear bridges: accept any credit at all (no extra Qloo calls).
  const loose = chosen.length < 3 ? [...strict, ...candidates(false)] : strict;
  if (chosen.length < 3) loose.forEach(tryAdd);

  // Everyone gets at least one reason with their name on it, when the data has one.
  for (const m of withPicks) {
    if (chosen.some((c) => c.bridge.from[m.id])) continue;
    const pick = loose.find((c) => c.bridge.from[m.id] && !chosen.includes(c) && !clashes(c));
    if (!pick) continue;
    if (chosen.length >= GROUP_MAX_BRIDGES) {
      // Drop the lowest-ranked bridge whose people are all credited elsewhere too.
      const spare = [...chosen].reverse().find((c) =>
        Object.keys(c.bridge.from).every((id) => chosen.some((o) => o !== c && o.bridge.from[id])),
      );
      if (!spare) continue;
      chosen.splice(chosen.indexOf(spare), 1);
    }
    chosen.push(pick);
  }

  chosen.sort((x, y) => y.rank - x.rank);

  // The pool for Larry: the board, then the strongest other candidates, varied across domains.
  const pool = coveragePool(
    [...chosen, ...strict, ...candidates(false)].map((c) => c.bridge),
    (br) => Object.entries(br.from).flatMap(([id, picks]) => picks.slice(0, 1).map((n) => `${id}:${n}`)),
    chosen.map((c) => c.bridge),
  );
  return { shared, chosen: spreadGroup(chosen.map((c) => c.bridge)), pool };
}

/** Like spreadOut: keep the ranking, but let domains and the people credited take turns. */
function spreadGroup(bridges: GroupBridge[]): GroupBridge[] {
  const peopleOf = (b: GroupBridge) => Object.keys(b.from).sort().join("|");
  const left = [...bridges];
  const out: GroupBridge[] = [];
  const domains = new Map<string, number>();
  const people = new Map<string, number>();
  while (left.length) {
    const cost = (b: GroupBridge) => (domains.get(b.domain) ?? 0) + (people.get(peopleOf(b)) ?? 0);
    const next = left.reduce((best, b) => (cost(b) < cost(best) ? b : best));
    left.splice(left.indexOf(next), 1);
    out.push(next);
    domains.set(next.domain, (domains.get(next.domain) ?? 0) + 1);
    people.set(peopleOf(next), (people.get(peopleOf(next)) ?? 0) + 1);
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A coordinate rounded to 3 decimals (about 110 m), for what is sent to Qloo. */
function coarse(deg: number): number {
  return Math.round(deg * 1000) / 1000;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------- places (PlaceCard)

/** A PlaceCard with daytime time chips (from Qloo's hours) and Qloo's one-line description. */
export type PlaceCardPlus = PlaceCard & {
  /** Qloo returned it as less known (popularity under LESS_KNOWN_MAX) WITH Hidden Gems applied. Never a guess. */
  lessKnown?: true;
  /** 2-3 daytime chips like "Sat 11am", from the opening hours. Empty when hours are unknown. */
  slots?: string[];
  /** Qloo's short description of the place, when it has one. */
  about?: string;
  /** The venue's own coordinates from Qloo (never the asker's), for walking time between two stops. */
  at?: { lat: number; lon: number };
};

export interface PlaceOptions {
  /** Search radius in metres for the first try (default 3000). */
  radius?: number;
  /** Widen to this radius once if too few good places were found (default 7000). Equal to radius: never widen. */
  maxRadius?: number;
  /** Places returned (default 6). */
  take?: number;
  /** Place ids to leave out (e.g. the plan's own place, for a plan B). */
  exclude?: string[];
  /** Vary the order of equally calm places per signal, so two people don't get the same list (default true). */
  vary?: boolean;
  /** The asker's own signals: Hidden Gems and age go to Qloo; mood moves the vibe order (moodVibes). */
  signals?: RequestSignals;
  /** Vibe order to follow instead of the mood's (a room's blended mood). */
  vibes?: PlaceVibe[];
  /** Places this person was shown lately: they go after every fresh place, never first. */
  recent?: string[];
  /**
   * Names of everything the people like beyond `items` (persona likes, bridges), so a niche place
   * (a devotional bookshop, say) stays only when someone's taste really points there.
   */
  tasteNames?: string[];
}

const PLACE_RADIUS = 3000;
const PLACE_MAX_RADIUS = 7000;
/** Most picks sent as one place signal. */
const PLACE_SIGNAL_MAX = 25;

/**
 * Low-pressure places near a location that match the given tastes, as PlaceCards: the kind of
 * place and why it's low-pressure, a calm / cosy / lively vibe from Qloo's own noise and ambience
 * tags, plain tags, opening hours and daytime time chips, a photo and the distance. Nightlife,
 * places closed every day, evening-only places and far-away places are dropped. It looks within
 * ~3 km first and widens once only when too few are left. Equally calm places take turns in an
 * order seeded by the signal, so two people nearby don't always get the same three.
 */
export async function findPlaces(
  items: { id: string; name: string }[],
  lat: number,
  lon: number,
  options: PlaceOptions | number = {},
): Promise<PlaceCardPlus[]> {
  const opts: PlaceOptions = typeof options === "number" ? { radius: options, maxRadius: options } : options;
  const take = opts.take ?? 6;
  const radius = opts.radius ?? PLACE_RADIUS;
  const maxRadius = Math.max(radius, opts.maxRadius ?? PLACE_MAX_RADIUS);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const signal = [...names.keys()].slice(0, PLACE_SIGNAL_MAX);
  if (signal.length === 0) return [];
  const exclude = new Set(opts.exclude ?? []);
  const recent = new Set(opts.recent ?? []);
  const extra = signalParams(opts.signals, "place");
  const taste = [...names.values(), ...(opts.tasteNames ?? [])];
  const teen = opts.signals?.ageBucket === "13-17";

  // Qloo gets the location to 3 decimals (about 110 m): plenty for a 500 m+ search, and no more
  // than a third party needs. The exact fix stays here, for the distance check below.
  const point = `POINT(${coarse(lon)} ${coarse(lat)})`;
  const round = async (r: number) => {
    const settled = await Promise.allSettled(
      HANGOUT_GROUPS.map((group) =>
        insightsCall(
          {
            "filter.type": "urn:entity:place",
            "signal.interests.entities": signal.join(","),
            "filter.location": point,
            "filter.location.radius": r,
            "filter.tags": group.tags.join(","),
            "operator.filter.tags": "union",
            "feature.explainability": true,
            take: 10,
          },
          extra,
        ).then(markLessKnown),
      ),
    );
    return settled;
  };
  const usable = (e: QlooEntity, r: number) => {
    if (exclude.has(e.entity_id) || !isHangout(e) || e.properties?.is_closed) return false;
    const week = parseHours(e.properties?.hours);
    if (week && closedAllDays(week)) return false;
    if (isNightlife(e, week)) return false;
    if (nicheMismatch(e, taste)) return false;
    // 13-17: nothing with a bar at all, even an arcade that has one.
    if (teen && tagIds(e).some((id) => DRINKING.has(categoryOf(id)))) return false;
    if (e.location && distanceKm(lat, lon, e.location.lat, e.location.lon) * 1000 > r * 1.25) return false;
    return true;
  };

  const first = await round(radius);
  if (first.every((r) => r.status === "rejected")) throw (first[0] as PromiseRejectedResult).reason;
  const lists = HANGOUT_GROUPS.map((g, i) => ({
    label: g.label,
    places: first[i].status === "fulfilled" ? (first[i] as PromiseFulfilledResult<QlooEntity[]>).value.filter((e) => usable(e, radius)) : [],
  }));
  const count = () => new Set(lists.flatMap((l) => l.places.map((e) => e.entity_id))).size;
  const withHours = () => new Set(lists.flatMap((l) => l.places.filter(hasHours).map((e) => e.entity_id))).size;
  // Too few good places nearby, or too few with real opening hours to give a real time: look once
  // more, further out (after the first round, not alongside it).
  if ((count() < take || withHours() < Math.min(HOURS_WANTED, take)) && maxRadius > radius) {
    const wider = await round(maxRadius);
    wider.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const have = new Set(lists[i].places.map((e) => e.entity_id));
      lists[i].places.push(...r.value.filter((e) => !have.has(e.entity_id) && usable(e, maxRadius)));
    });
  }

  const seed = opts.vary === false ? undefined : [...signal].sort().join(",");
  const groups = rankHangoutGroups(lists).map((g) => (seed === undefined ? g : varyTies(g, seed)));
  // Take turns between groups (calmest first) so the list mixes games, a library, books and cafés.
  // Fresh places with real hours first, then fresh ones without, then places shown lately. One
  // venue is never listed twice, even under two Qloo ids.
  const picked: QlooEntity[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const passes: ((e: QlooEntity) => boolean)[] = [(e) => !recent.has(e.entity_id) && hasHours(e), (e) => !recent.has(e.entity_id), () => true];
  for (const pass of passes) {
    for (let r = 0; picked.length < take && groups.some((g) => g.length > r); r++) {
      for (const g of groups) {
        const e = g[r];
        if (!e || !pass(e) || picked.length >= take || seen.has(e.entity_id) || seenNames.has(venueKey(e.name))) continue;
        seen.add(e.entity_id);
        seenNames.add(venueKey(e.name));
        picked.push(e);
      }
    }
  }

  return orderPlaces(picked, { vibes: opts.vibes ?? moodVibes(opts.signals?.mood), recent }).map((e) => toPlaceCard(e, names, lat, lon));
}

/**
 * `recentPlaces` from a request body (chat-protocol RECENT_PLACES_MAX): place ids this phone was
 * shown lately. Anything that isn't a list of id-shaped strings is ignored, never an error.
 */
export function recentPlacesFrom(body: unknown): string[] {
  const raw = body && typeof body === "object" ? (body as { recentPlaces?: unknown }).recentPlaces : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && /^[\w.:-]{1,64}$/.test(x)).slice(0, RECENT_PLACES_MAX);
}

/** How many places with known hours a search wants before it widens once. */
const HOURS_WANTED = 3;
const hasHours = (e: QlooEntity) => {
  const week = parseHours(e.properties?.hours);
  return !!week && daytimeSlots(week).length > 0;
};

/** A venue's name for spotting the same place twice ("Title Waves" vs "Title Waves, Bandra"). */
export function venueKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[,(|–-]/)[0]
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|cafe|caf|store|shop|mumbai|bandra|india)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The final order: places shown lately always go last. Otherwise, with a mood (or a room's blend),
 * places follow its vibe order (Chill: calm, cosy, lively; Hype: lively, cosy, calm). Without one,
 * calm places come first and a chain or a busy place only after every calm one.
 */
export function orderPlaces(picked: QlooEntity[], opts: { vibes?: PlaceVibe[]; recent?: Set<string> } = {}): QlooEntity[] {
  const recent = opts.recent ?? new Set<string>();
  const rank = (e: QlooEntity) => {
    if (opts.vibes) {
      const v = placeVibe(e);
      const i = v ? opts.vibes.indexOf(v) : -1;
      return i < 0 ? 1.5 : i;
    }
    return isBusy(e) ? 1 : 0;
  };
  return picked
    .map((e, i) => ({ e, i }))
    .sort((x, y) => Number(recent.has(x.e.entity_id)) - Number(recent.has(y.e.entity_id)) || rank(x.e) - rank(y.e) || x.i - y.i)
    .map((x) => x.e);
}

/**
 * Niche places that suit only people whose taste points there. An unrelated niche shop (say, a
 * devotional shop for a Ghibli-and-Minecraft pair) stays only
 * when one of the people's picks (or persona likes) is in the same niche.
 */
const NICHES: RegExp[] = [
  /\b(devotional|religio\w*|bible|biblical|christian|catholic|pauline|gospel|church|chapel|islamic|quran|qur'an|hindu|vedic|iskcon|gita|spiritual\w*|theolog\w*|missionar\w*|sufi|jain|buddhis\w*|scriptur\w*)\b|\b(st\.?|saint)\s+\w+'?s?\s+(book|books|book centre|book center)\b/i,
  /\b(text ?books?|exam prep|competitive exams?|school supplies|educational supplies|stationery)\b/i,
  /\b(law books?|medical books?|engineering books?)\b/i,
];
export function nicheMismatch(e: Pick<QlooEntity, "name" | "properties" | "tags">, taste: string[]): boolean {
  const text = [
    e.name,
    e.properties?.short_description ?? "",
    e.properties?.description?.slice(0, 400) ?? "",
    ...(e.tags ?? []).map((t) => `${t.name ?? ""} ${(t.id ?? t.tag_id ?? "").split(":").pop()?.replace(/_/g, " ") ?? ""}`),
  ].join(" | ");
  const tasteText = taste.join(" | ");
  return NICHES.some((re) => re.test(text) && !re.test(tasteText));
}

function toPlaceCard(e: QlooEntity, names: Map<string, string>, lat: number, lon: number): PlaceCardPlus {
  // A pick whose name was cleaned away can't give a reason, so it is skipped.
  const named = scoredContributors(e).filter((c) => names.get(c.entity_id));
  const [top, next] = named;
  // Name a second pick when it drove the result almost as much, so reasons aren't all alike.
  const why = top && next && next.score >= top.score * 0.8 ? [top, next] : top ? [top] : [];
  const cats = new Set(tagIds(e).map(categoryOf));
  const kind = KINDS.find(([ids]) => ids.some((id) => cats.has(id)))?.[1];
  // Qloo's explainability is evidence, not a line to show as if it were a fact about the crowd: it
  // goes in the small "Why?" chip, worded as what it is. The visible line is about the place itself.
  const qlooWhy = why.length ? `Larry found that people who like ${why.map((c) => names.get(c.entity_id)).join(" and ")} rate this place.` : undefined;
  const feel = quietScore(e) > 0 && busyScore(e) === 0 ? "Usually quiet." : isBusy(e) ? "It can get busy." : "";
  const week = parseHours(e.properties?.hours);
  // Qloo's description, else its ambience description: what Larry reads to pick a quieter or livelier rung.
  const about = (e.properties?.short_description || e.properties?.ambience_description || "").trim().slice(0, 200) || undefined;
  return {
    id: e.entity_id,
    name: e.name,
    image: qlooImage(e.properties?.image?.url),
    address: e.properties?.address,
    distanceKm: e.location ? Math.round(distanceKm(lat, lon, e.location.lat, e.location.lon) * 10) / 10 : undefined,
    tags: plainTags(e),
    affinity: e.query?.affinity ?? 0,
    reason: [kind, feel, firstSentence(about)].filter(Boolean).join(" ") || undefined,
    ...(qlooWhy ? { qlooWhy } : {}),
    vibe: placeVibe(e),
    hours: week ? hoursText(week) : undefined,
    slots: week ? daytimeSlots(week) : [],
    about,
    ...(e.location ? { at: { lat: e.location.lat, lon: e.location.lon } } : {}),
    ...gemFlag(e),
    fits: [],
  };
}

/** The first sentence of Qloo's description, when it is short enough to read at a glance. */
function firstSentence(text?: string, max = 110): string | undefined {
  const first = text?.split(/(?<=[.!?])\s/)[0]?.trim();
  if (!first || first.length > max) return undefined;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** Stable small hash (FNV-1a) for seeding. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Keeps the calm ranking, but lets places that rank the same on calmness (same kind tier, busy
 * flag and quiet-minus-busy tags) swap places by a hash of the signal: the same person sees a stable list, two
 * different people see different first picks.
 */
function varyTies(list: QlooEntity[], seed: string): QlooEntity[] {
  const key = (e: QlooEntity) => `${calmTier(e)}|${isBusy(e)}|${quietScore(e) - busyScore(e)}`;
  const out: QlooEntity[] = [];
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j < list.length && key(list[j]) === key(list[i])) j++;
    out.push(...list.slice(i, j).sort((x, y) => hash(seed + x.entity_id) - hash(seed + y.entity_id)));
    i = j;
  }
  return out;
}

// ---- vibe and tags

const NOISE_CALM = /^urn:tag:noise_level:qloo:(?:quiet|low|very_quiet)$/;
const NOISE_LIVELY = /^urn:tag:noise_level:qloo:(?:loud|high|very_loud)$/;
const NOISE_MID = /^urn:tag:noise_level:qloo:(?:moderate|average|medium)$/;
const AMB_CALM = /^urn:tag:ambience:qloo:(?:quiet|calm|relaxed|relaxing|peaceful|tranquil|serene|laid_back|low_key|chill|studious|contemplative)$/;
const AMB_COSY = /^urn:tag:ambience:qloo:(?:cozy|cosy|comfortable|intimate|warm|welcoming|homey|homely|charming|quaint|rustic)$/;
const AMB_LIVELY = /^urn:tag:ambience:qloo:(?:lively|loud|noisy|bustling|energetic|vibrant|crowded|party|rowdy|high_energy|upbeat|festive)$/;

/**
 * Calm, cosy or lively, from Qloo's own place data: the noise-level tag counts first (Qloo's
 * ambience adjectives contradict each other: the British Library is tagged both lively and quiet),
 * then the ambience tags, then the ambience description, then the kind of place.
 */
export function placeVibe(e: QlooEntity): PlaceVibe | undefined {
  const ids = tagIds(e);
  const n = (re: RegExp) => ids.filter((id) => re.test(id)).length;
  const calm = n(AMB_CALM);
  const cosy = n(AMB_COSY);
  const lively = n(AMB_LIVELY);
  if (n(NOISE_CALM)) return "calm";
  if (n(NOISE_LIVELY)) return "lively";
  if (n(NOISE_MID)) return lively > calm + cosy ? "lively" : "cosy";
  if (lively > calm + cosy) return "lively";
  if (calm && calm >= cosy && !lively) return "calm";
  if (cosy) return "cosy";
  if (calm) return "calm";
  const text = (e.properties?.ambience_description ?? "").toLowerCase();
  if (/\b(loud|lively|energetic|buzzing|bustling|vibrant|noisy)\b/.test(text)) return "lively";
  if (/\b(quiet|calm|peaceful|tranquil|serene|hushed)\b/.test(text)) return "calm";
  if (/\b(cozy|cosy|warm|intimate|snug)\b/.test(text)) return "cosy";
  const cats = new Set(ids.map(categoryOf));
  if (cats.has("library") || cats.has("public_library") || cats.has("book_store")) return "calm";
  if (cats.has("video_arcade")) return "lively";
  if (cats.has("board_game_club") || cats.has("tea_house") || cats.has("cafe")) return "cosy";
  return undefined;
}

/** Plain, easy-read tags from Qloo's place data, kind of place first. */
const PLAIN_TAGS: [RegExp, string][] = [
  [/^urn:tag:category:place:board_game_club$/, "Board games"],
  [/^urn:tag:category:place:video_arcade$/, "Arcade"],
  [/^urn:tag:category:place:game_store$/, "Game shop"],
  [/^urn:tag:category:place:comic_book_store$/, "Comics"],
  [/^urn:tag:category:place:book_store$/, "Books"],
  [/^urn:tag:category:place:(?:public_)?library$/, "Library"],
  [/^urn:tag:category:place:tea_house$/, "Tea"],
  [/^urn:tag:category:place:(?:cafe|coffee_shop|coffee_store|art_cafe)$/, "Café"],
  [/^urn:tag:noise_level:qloo:(?:quiet|low|very_quiet)$/, "Quiet"],
  [/^urn:tag:amenit(?:y|ies):(?:place|qloo):wi_?fi$/, "Wi-Fi"],
  [/wheelchair_accessible/, "Wheelchair access"],
  [/^urn:tag:amenity:qloo:outdoor_seating$/, "Outdoor seating"],
];
function plainTags(e: QlooEntity): string[] {
  const ids = tagIds(e);
  const out: string[] = [];
  for (const [re, label] of PLAIN_TAGS) if (ids.some((id) => re.test(id)) && !out.includes(label)) out.push(label);
  return out.slice(0, 5);
}

// ---- nightlife

const NIGHTLIFE_TAG = /^urn:tag:(?:interests|activity_type):qloo:nightlife$/;
const NIGHTLIFE_TEXT = /\b(nightlife|night ?club|dance floor|cocktail bar|club-like|pub crawl)\b/i;
/**
 * Bars and nightlife never make a first plan: tagged nightlife (145 Bandra: a café by day, a party
 * by night), described as a nightclub, or only open in the evening. A board-game café or arcade
 * tagged nightlife stays when it opens in the daytime.
 */
function isNightlife(e: QlooEntity, week?: WeekHours): boolean {
  if (week && eveningOnly(week)) return true;
  const tagged = tagIds(e).some((id) => NIGHTLIFE_TAG.test(id)) || NIGHTLIFE_TEXT.test(e.properties?.short_description ?? "");
  if (!tagged) return false;
  const strong = tagIds(e).some((id) => STRONG_HANGOUT.has(categoryOf(id)));
  const bar = tagIds(e).some((id) => DRINKING.has(categoryOf(id)));
  return !(strong && !bar && (!week || opensInDaytime(week)));
}

// ---- opening hours

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Minutes from midnight; `close` past 1440 means after midnight. */
type Span = { open: number; close: number };
/** Monday first. A day with no spans is closed. */
export type WeekHours = Span[][];

const toMinutes = (t?: string) => {
  const m = /^T?(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** Qloo's `hours` (weekday -> [{opens: "T09:00:00", closes, closed}]) as spans, or undefined when unknown. */
export function parseHours(raw: unknown): WeekHours | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const byDay = raw as Record<string, unknown>;
  if (!WEEKDAYS.some((d) => Array.isArray(byDay[d]))) return undefined;
  return WEEKDAYS.map((d) => {
    const spans = byDay[d];
    if (!Array.isArray(spans)) return [];
    return spans.flatMap((sp: QlooHoursSpan | null) => {
      if (!sp || sp.closed) return [];
      const open = toMinutes(sp.opens);
      const close = toMinutes(sp.closes);
      if (open === undefined || close === undefined) return [];
      return [{ open, close: close <= open ? close + 1440 : close }];
    });
  });
}

/** Qloo lists the place but every day is closed (Bombay Coffee House: is_closed=false, closed daily). */
export const closedAllDays = (week: WeekHours) => week.every((d) => d.length === 0);
/** Open for at least 90 minutes between 10am and 6pm on some day. */
const opensInDaytime = (week: WeekHours) =>
  week.some((d) => d.some((s) => Math.min(s.close, 18 * 60) - Math.max(s.open, 10 * 60) >= 90));
/** Opens only from 5pm on, every day it opens: a bar, whatever its tags say. */
const eveningOnly = (week: WeekHours) => !closedAllDays(week) && week.every((d) => d.every((s) => s.open >= 17 * 60));

function clock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Easy-read hours: "Daily 9am-9pm", or "Mon-Fri 9am-6pm, Sat 10am-4pm, Sun closed". */
export function hoursText(week: WeekHours): string {
  const label = (d: Span[]) => (d.length ? d.map((s) => `${clock(s.open)}-${clock(s.close)}`).join(", ") : "closed");
  const labels = week.map(label);
  if (labels.every((l) => l === labels[0])) return labels[0] === "closed" ? "Closed" : `Daily ${labels[0]}`;
  const parts: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && labels[j + 1] === labels[i]) j++;
    parts.push(`${i === j ? DAY_SHORT[i] : `${DAY_SHORT[i]}-${DAY_SHORT[j]}`} ${labels[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * Up to `n` daytime time chips ("Sat 11am", "Thu 5pm") over the next week, starting tomorrow:
 * only between 10am and 5pm, never within 90 minutes of closing. Weekends lean to late morning,
 * weekdays to after school or work. Closing after midnight counts as open late.
 */
export function daytimeSlots(week: WeekHours, now: Date = new Date(), n = 3): string[] {
  const out: string[] = [];
  const today = (now.getDay() + 6) % 7; // Monday = 0
  for (let offset = 1; offset <= 7 && out.length < n; offset++) {
    const day = (today + offset) % 7;
    const weekend = day >= 5;
    const times = weekend ? [11 * 60, 14 * 60, 16 * 60] : [17 * 60, 16 * 60, 14 * 60, 11 * 60];
    const t = times.find((t) => week[day].some((s) => s.open <= t && s.close - t >= 90));
    if (t !== undefined) out.push(`${DAY_SHORT[day]} ${clock(t)}`);
  }
  return out;
}

// ---- per-person fit

/** One person a place is judged for: their picks and what Larry knows about places they like. */
export interface FitPerson {
  /** "a"/"b" in a pair, a member id in a group, "me" solo. */
  who: string;
  name: string;
  items: { id: string; name: string }[];
  persona?: Pick<Persona, "dislikes" | "notes" | "placeVibe">;
}

/** Qloo's view of how each place suits one person: affinity, and the pick of theirs behind it. */
async function placeHints(placeIds: string[], person: FitPerson): Promise<Map<string, { affinity: number; pick?: string }>> {
  const out = new Map<string, { affinity: number; pick?: string }>();
  const signal = person.items.slice(0, PLACE_SIGNAL_MAX);
  if (!placeIds.length || !signal.length) return out;
  const names = new Map(signal.map((i) => [i.id, i.name]));
  const body = await qloo("/v2/insights", {
    "filter.type": "urn:entity:place",
    "filter.results.entities": placeIds.join(","),
    "signal.interests.entities": signal.map((i) => i.id).join(","),
    "feature.explainability": true,
    take: placeIds.length,
  });
  for (const e of (body.results?.entities ?? []) as QlooEntity[]) {
    const top = scoredContributors(e).find((c) => names.has(c.entity_id));
    out.set(e.entity_id, { affinity: e.query?.affinity ?? 0, pick: top ? names.get(top.entity_id) : undefined });
  }
  return out;
}

/**
 * A plain fit without the model: a vibe that clashes with the place vibe someone likes is "not
 * for them"; a matching vibe, or Qloo ranking the place in that person's top half with one of
 * their picks behind it, is "likes"; anything else is "maybe".
 */
export function ruleFit(place: PlaceCard, person: FitPerson, hint?: { pick?: string; topHalf: boolean }): PlaceFit {
  const pref = person.persona?.placeVibe;
  const vibe = place.vibe;
  const clash = !!pref && !!vibe && ((pref === "calm" && vibe === "lively") || (pref === "lively" && vibe === "calm"));
  if (clash) return { who: person.who, likely: "not-for-them", why: `It can be ${vibe}, and ${person.name} likes ${pref} places.` };
  // Never "fans of X go here": Qloo ranks places for a taste, it doesn't count who goes. Say what is
  // known, and name this place's own kind and this person's own pick, so no two lines read alike.
  const kind = place.tags[0]?.toLowerCase();
  if (pref && vibe === pref) {
    return { who: person.who, likely: "likes", why: hint?.pick ? `${cap(vibe)}, and it goes with ${hint.pick}.` : `${cap(vibe)}${kind ? ` ${kind}` : ""}, the kind ${person.name} likes.` };
  }
  if (hint?.pick && hint.topHalf) return { who: person.who, likely: "likes", why: kind ? `${cap(kind)}, and it goes with ${hint.pick}.` : `It goes with ${hint.pick}.` };
  if (hint?.pick) return { who: person.who, likely: "maybe", why: `A small link to ${hint.pick}. Worth a look.` };
  return { who: person.who, likely: "maybe", why: kind ? `${cap(kind)}. No clear link to ${person.name}'s picks yet.` : `No clear link to ${person.name}'s picks yet.` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Places kept when pruning weak fits (dropPoorFits), so a thin area still offers a choice. */
const MIN_PLACES_KEPT = 3;

/**
 * Leaves out places nobody here plausibly fits: every person "not-for-them", or (while at least
 * MIN_PLACES_KEPT better places remain) no one likes it and Qloo found no link to anyone's picks.
 * `linked` says which place ids Qloo tied to at least one person's pick.
 */
export function dropPoorFits<T extends Pick<PlaceCard, "id" | "fits">>(places: T[], linked?: Set<string>): T[] {
  const ruledOut = (p: T) => p.fits.length > 0 && p.fits.every((f) => f.likely === "not-for-them");
  const weak = (p: T) => !!linked && !linked.has(p.id) && !p.fits.some((f) => f.likely === "likes");
  const kept = places.filter((p) => !ruledOut(p));
  const strong = kept.filter((p) => !weak(p));
  return strong.length >= MIN_PLACES_KEPT ? strong : kept;
}

/**
 * Says for each person whether each place is likely for them, with a short grounded why: Qloo
 * is asked once per person how the places suit their picks, plain rules give a first answer, and
 * one model call (unless `curate: false`, or the model is off or out of budget) refines it with
 * the person's persona and the place's own description. Places come back in the same order,
 * without the ones nobody fits (dropPoorFits; `keepAll` keeps them).
 */
export async function addPlaceFits(
  places: PlaceCardPlus[],
  people: FitPerson[],
  opts: CurateOptions & { keepAll?: boolean } = {},
): Promise<PlaceCardPlus[]> {
  if (!places.length || !people.length) return places;
  const ids = places.map((p) => p.id);
  const limit = limiter(2);
  const hints = await Promise.all(people.map((p) => limit(() => placeHints(ids, p).catch(() => new Map<string, { affinity: number; pick?: string }>()))));
  const linked = new Set(places.filter((p) => hints.some((h) => h.get(p.id)?.pick)).map((p) => p.id));
  const withRules = places.map((place) => ({
    ...place,
    fits: people.map((person, pi) => {
      const h = hints[pi];
      const mine = h.get(place.id);
      const ranked = [...h.values()].map((x) => x.affinity).sort((x, y) => y - x);
      const topHalf = !!mine && ranked.indexOf(mine.affinity) < Math.ceil(ranked.length / 2);
      return ruleFit(place, person, mine ? { pick: mine.pick, topHalf } : undefined);
    }),
  }));
  if (opts.curate === false) return opts.keepAll ? withRules : dropPoorFits(withRules, linked);

  const judged = await judgePlaceFits(
    {
      places: withRules.map((p) => ({
        id: p.id,
        name: p.name,
        tags: p.tags,
        vibe: p.vibe,
        about: p.about,
        qloo: Object.fromEntries(people.map((person, pi) => [person.who, hints[pi].get(p.id)?.pick ?? null])),
      })),
      people: people.map((p) => ({
        key: p.who,
        name: p.name,
        picks: p.items.slice(0, 12).map((i) => i.name),
        dislikes: p.persona?.dislikes.slice(0, 10).map((d) => d.name),
        notes: p.persona?.notes.slice(0, 8),
        placeVibe: p.persona?.placeVibe,
      })),
    },
    { charge: opts.charge, signal: opts.signal },
  );
  const out = judged ? withRules.map((p) => ({ ...p, fits: p.fits.map((f) => judged.get(`${p.id}|${f.who}`) ?? f) })) : withRules;
  return opts.keepAll ? out : dropPoorFits(out, linked);
}

/** A cover photo only from Qloo's own image host, so venue cards never load third-party URLs. */
export function qlooImage(url: string | undefined): string | undefined {
  const safe = safeImage(url);
  if (!safe) return undefined;
  try {
    return new URL(safe).hostname === "images.qloo.com" ? safe : undefined;
  } catch {
    return undefined;
  }
}

/** Qloo tags that say the place is quiet or cosy. */
const quietScore = (e: QlooEntity) => tagIds(e).filter((id) => QUIET_TAG.test(id)).length;
/** Qloo tags that say the place is lively, loud or crowded. */
const busyScore = (e: QlooEntity) => tagIds(e).filter((id) => BUSY_TAG.test(id)).length;
/** A big chain, or a place Qloo tags as busier than quiet: fine, but not a first choice. */
function isBusy(e: QlooEntity): boolean {
  return CHAIN.test(e.name) || busyScore(e) > quietScore(e);
}

/** A place's anxiety-friendliness tier: its calmest category (4 when none is known). */
function calmTier(e: QlooEntity): number {
  const tiers = tagIds(e).map((id) => CALM_TIER[categoryOf(id)]).filter((t) => t !== undefined);
  return Math.min(4, ...tiers);
}

/**
 * Hangouts per group, ready to take turns from: groups in calm order (games, library, books,
 * cafés), and inside each group the calmest kind first, then calm before busy (chains, and places
 * Qloo tags lively, bustling or loud), then places Qloo tags quiet or cosy, then Qloo's affinity. So the first place (the one offered as a First Step) is the most structured one found,
 * never a plain café that happened to score higher.
 */
export function rankHangoutGroups(groups: { label: string; places: QlooEntity[] }[]): QlooEntity[][] {
  return [...groups]
    .sort((x, y) => (GROUP_TIER[x.label] ?? 9) - (GROUP_TIER[y.label] ?? 9))
    .map((g) =>
      g.places
        .filter(isHangout)
        .sort(
          (x, y) =>
            calmTier(x) - calmTier(y) ||
            Number(isBusy(x)) - Number(isBusy(y)) ||
            quietScore(y) - busyScore(y) - (quietScore(x) - busyScore(x)) ||
            (y.query?.affinity ?? 0) - (x.query?.affinity ?? 0),
        ),
    );
}

const categoryOf = (tagId: string) => (tagId.includes(":category:") ? tagId.split(":").pop()! : "");

/** A real, low-pressure hangout: not a bar, restaurant-only spot, landmark or campus. */
function isHangout(e: QlooEntity): boolean {
  const cats = new Set(tagIds(e).map(categoryOf).filter(Boolean));
  if ([...cats].some((c) => NEVER.has(c))) return false;
  if (![...cats].some((c) => HANGOUT.has(c))) return false;
  const strong = [...cats].some((c) => STRONG_HANGOUT.has(c));
  return strong || ![...cats].some((c) => DRINKING.has(c));
}

// ---------------------------------------------------------------- Hidden Gems as Larry's offer (/gems)

/** Where a gem item may come from. Strict (solo under-18s, unknown-age chats): music, games, books only. */
export const GEM_DOMAINS: Domain[] = ["movie", "tv_show", "artist", "videogame", "book", "podcast"];
export const GEM_DOMAINS_STRICT: Domain[] = ["artist", "videogame", "book"];
const GEM_TAKE = 12;
/** Tags that keep an item out of the strict set, whatever its popularity. */
const MATURE_TAG = /(?:adult|erotic|explicit|nsfw|mature|horror|gore|slasher|sexual|drug)/i;

/** One gem from everyone's picks: a single item, with whose picks led there. */
export interface GemOffer {
  item: TasteItem;
  /** The people and the pick of theirs Qloo credits most for it. */
  credits: { name: string; pick: string }[];
  /** Plain "Why this?" line naming those picks. */
  why: string;
  /** Qloo's popularity percentile for it, when returned. */
  popularity?: number;
  /** True only when Qloo applied the less-known filter AND returned it under LESS_KNOWN_MAX: the only time it may be called a hidden gem. */
  lessKnown: boolean;
  /** The filter left nothing (or was refused), so this is the best-known fit instead: say so, no badge. */
  fellBack: boolean;
}

/** The gem domain: the one these people picked least in (a fresh angle), Qloo's order on ties. */
export function gemDomain(people: Pick<Profile, "items">[], strict = false): Domain {
  const allowed = strict ? GEM_DOMAINS_STRICT : GEM_DOMAINS;
  const count = (d: Domain) => people.reduce((n, p) => n + p.items.filter((i) => i.domain === d).length, 0);
  return [...allowed].sort((a, b) => count(a) - count(b) || allowed.indexOf(a) - allowed.indexOf(b))[0];
}

/**
 * Hidden Gems as Larry's offer (qloo-hooks-plan 3.3, for `/gems`): one less-known item that the
 * group's own picks point to, from one Qloo call with `filter.popularity.max=LESS_KNOWN_MAX` and
 * explainability. In a group it must be credited from at least two people's picks; alone, from
 * one. Sequels of anyone's picks are dropped. `lessKnown` is the truth label (P2): false when Qloo
 * fell back to the unfiltered call or returned something above the line. Null when nothing fits.
 */
export async function gemsFor(people: Profile[], opts: { strict?: boolean; domain?: Domain; exclude?: string[] } = {}): Promise<GemOffer | null> {
  const withPicks = people.filter((p) => p.items.length);
  if (!withPicks.length) return null;
  const domain = opts.domain && (!opts.strict || GEM_DOMAINS_STRICT.includes(opts.domain)) ? opts.domain : gemDomain(withPicks, opts.strict);
  // Who picked what, so Qloo's credit can be turned into "Priya's Spirited Away".
  const owners = new Map<string, { item: TasteItem; names: string[] }>();
  for (const p of withPicks) {
    for (const i of p.items) {
      const o = owners.get(i.id) ?? { item: i, names: [] };
      if (!o.names.includes(p.name)) o.names.push(p.name);
      owners.set(i.id, o);
    }
  }
  const allPicks = [...owners.values()].map((o) => o.item);
  const exclude = new Set(opts.exclude ?? []);
  const signal = [...owners.keys()].slice(0, PLACE_SIGNAL_MAX);
  const tags = domainTags(domain);
  const result = await insightsCall(
    {
      "filter.type": DOMAINS[domain].urn,
      ...(tags.length ? { "filter.tags": tags.join(",") } : {}),
      "signal.interests.entities": signal.join(","),
      "feature.explainability": true,
      take: GEM_TAKE,
    },
    { "filter.popularity.max": LESS_KNOWN_MAX },
  );
  const needPeople = withPicks.length >= 2 ? 2 : 1;
  for (const e of result.entities) {
    if (owners.has(e.entity_id) || exclude.has(e.entity_id) || !e.name) continue;
    if (allPicks.some((p) => sameFranchise(e.name, p.name))) continue;
    if (opts.strict && tagIds(e).some((t) => MATURE_TAG.test(t))) continue;
    const credits: { name: string; pick: string }[] = [];
    for (const c of scoredContributors(e)) {
      const o = owners.get(c.entity_id);
      if (!o) continue;
      const who = o.names.find((n) => !credits.some((x) => x.name === n));
      if (who) credits.push({ name: who, pick: o.item.name });
    }
    if (credits.length < needPeople) continue;
    return {
      item: toItem(e, domain),
      credits: credits.slice(0, 3),
      why: plainWhy(credits.slice(0, 3)),
      ...(typeof e.popularity === "number" ? { popularity: Math.round(e.popularity * 1000) / 1000 } : {}),
      lessKnown: isLessKnownResult(e, result),
      fellBack: result.fellBack,
    };
  }
  return null;
}
