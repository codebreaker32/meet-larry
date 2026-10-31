// Taste Fingerprint (queue #2, plan 1E, revised by qloo-hooks-plan 3.2): how a card sits against
// everyone's taste, from real Qloo scores. Pure and shared by the server (/api/fingerprint) and the
// share images on the device.
//
//  - lessKnown: a COUNT, "4 of your 6 picks are outside Qloo's top 10%" (Qloo's `popularity` is a
//    0-1 percentile). Needs at least 3 picks Qloo knows; never a guess, never a percentage on screen.
//  - strongest: the categories the card leans on. Used only to choose where to look for the Twin;
//    "Strongest in ..." is gone (it just counted picks, Qloo added nothing).
//  - twin: the Taste Twin, one real cross-domain Qloo recommendation, shown as an "Ask me about ..."
//    line so the person across the table has an easy question. Larry picks the most surprising true one.
//
// HARD RULE (plan 1E, tested): a shared image never carries a venue, a title (Final Boss, Rookie ...),
// Glory or a date. Every line drawn on a share canvas passes shareSafe() first.

import { DOMAIN_STYLE } from "./domain-style";
import { STAGES, PUBLIC_TITLES, FRIEND_RANK_TITLES } from "./types/titles";
import { TITLES, GLORY } from "./titles";
import type { Domain, TasteItem } from "./types";
import type { Fingerprint } from "./types/signals-ui";
import { LESS_KNOWN_MAX } from "./types/signals";

/** Picks Qloo ranks under this popularity percentile count as less known: the app's one line (P3). */
export const MAINSTREAM_POPULARITY = LESS_KNOWN_MAX;
/** No number until Qloo knows at least this many of the picks. */
export const FINGERPRINT_MIN_PICKS = 3;
/** At most this many strongest categories (where the Twin is looked for). */
export const STRONGEST_MAX = 2;
/** Larry's caption: one or two short sentences. */
export const CAPTION_MAX_CHARS = 140;
export const CAPTION_MAX_WORDS = 26;

/** What /api/fingerprint answers: the contract's Fingerprint plus Larry's caption (AI-labelled where shown). */
export interface FingerprintView extends Fingerprint {
  /** Larry's line about this card, from the numbers above. Missing when nothing could be said. */
  caption?: string;
  /** "model": Larry wrote it. "fallback": the fixed line. */
  captionSource?: "model" | "fallback";
  /** The pick behind the twin, for the sentence ("Your Minecraft side"). */
  twinBecause?: string;
  /** "4 of your 6": picks under LESS_KNOWN_MAX out of the picks Qloo knows. Missing under 3 known picks. */
  lessKnown?: LessKnownCount;
}

/** How many picks are outside Qloo's top 10%, out of how many Qloo knows. */
export interface LessKnownCount {
  count: number;
  known: number;
}

/** A pick with Qloo's popularity percentile, when Qloo knows it. */
export interface ScoredPick {
  item: TasteItem;
  popularity?: number;
}

/** A cross-domain candidate for the Taste Twin: a real Qloo recommendation. */
export interface TwinCandidate {
  fromDomain: Domain;
  toDomain: Domain;
  entity: TasteItem;
  /** Qloo affinity, 0-1. */
  affinity: number;
  popularity?: number;
  /** The pick that drove it most (Qloo explainability), if known. */
  because?: string;
}

const label = (d: Domain) => DOMAIN_STYLE[d].label;
const lower = (d: Domain) => label(d).toLowerCase();

/**
 * The count behind the Fingerprint: picks Qloo ranks under LESS_KNOWN_MAX, out of the picks Qloo
 * returned a popularity for. Undefined (left out, never guessed) when Qloo knows fewer than 3.
 */
export function lessKnownCount(picks: ScoredPick[], threshold = MAINSTREAM_POPULARITY): LessKnownCount | undefined {
  const known = picks.filter((p) => typeof p.popularity === "number" && Number.isFinite(p.popularity));
  if (known.length < FINGERPRINT_MIN_PICKS) return undefined;
  return { count: known.filter((p) => (p.popularity as number) < threshold).length, known: known.length };
}

/** The same count as a share, 0-100: only Larry's caption data uses it. Undefined under 3 known picks. */
export function offBeatenPct(picks: ScoredPick[], threshold = MAINSTREAM_POPULARITY): number | undefined {
  const c = lessKnownCount(picks, threshold);
  return c ? Math.round((c.count / c.known) * 100) : undefined;
}

/** `{ lessKnown }` for the answer, or nothing under 3 known picks. */
export const lessKnownField = (picks: ScoredPick[]): { lessKnown?: LessKnownCount } => {
  const c = lessKnownCount(picks);
  return c ? { lessKnown: c } : {};
};

/**
 * The Fingerprint line, never a judgement: "4 of your 6 picks are outside Qloo's top 10%.", or for a
 * card of well-known picks "You like the classics. Easy openers, everyone knows them." `who: "my"`
 * is for the share image.
 */
export function lessKnownLine(c: LessKnownCount | undefined, who: "your" | "my" = "your"): string {
  if (!c) return "";
  if (c.count === 0) return who === "my" ? "I like the classics. Easy openers, everyone knows them." : "You like the classics. Easy openers, everyone knows them.";
  return `${c.count} of ${who} ${c.known} picks ${c.count === 1 ? "is" : "are"} outside the top 10% most popular.`;
}

/** Shown instead of a number when Qloo knows too few of the picks. */
export const LESS_KNOWN_TOO_FEW = "Not enough of your picks are known enough yet to give a number. Add one more?";

/**
 * The categories the card leans on: most picks first; ties go to the category with the less
 * mainstream picks (that is what makes it a fingerprint), then the app's category order.
 */
export function strongestDomains(picks: ScoredPick[], max = STRONGEST_MAX): Domain[] {
  const by = new Map<Domain, { n: number; pop: number; known: number; first: number }>();
  picks.forEach((p, i) => {
    const d = by.get(p.item.domain) ?? { n: 0, pop: 0, known: 0, first: i };
    d.n++;
    if (typeof p.popularity === "number") {
      d.pop += p.popularity;
      d.known++;
    }
    by.set(p.item.domain, d);
  });
  const meanPop = (x: { pop: number; known: number }) => (x.known ? x.pop / x.known : 1);
  return [...by.entries()]
    .sort(([, x], [, y]) => y.n - x.n || meanPop(x) - meanPop(y) || x.first - y.first)
    .slice(0, max)
    .map(([d]) => d);
}

/**
 * The deterministic Taste Twin: the strongest true recommendation, preferring ones Qloo ranks
 * outside the top 1% (a surprise beats the obvious). Larry's own pick replaces it when the model runs.
 */
export function fallbackTwin(cands: TwinCandidate[]): TwinCandidate | undefined {
  const score = (c: TwinCandidate) => c.affinity + ((c.popularity ?? 1) < MAINSTREAM_POPULARITY ? 0.5 : 0);
  return [...cands].sort((a, b) => score(b) - score(a))[0];
}


/** DESIGN.md: always a full sentence, never an arrow. "Your Minecraft side, in music: beabadoobee." */
export function twinSentence(twin: Fingerprint["twin"], because?: string): string {
  if (!twin) return "";
  const side = because ? `Your ${because} side` : `Your ${lower(twin.fromDomain)} side`;
  return `${side}, in ${lower(twin.toDomain)}: ${twin.entity.name}.`;
}

/**
 * The Taste Twin as a question someone can ask you (qloo-hooks-plan 3.4, job 1): "Ask me about
 * beabadoobee." At most 12 words. Empty without a twin.
 */
export function askMeLine(twin: Fingerprint["twin"]): string {
  if (!twin) return "";
  const line = `Ask me about ${twin.entity.name}.`;
  return line.split(/\s+/).length <= 12 ? line : "";
}

/** The plain line under it, naming the pick behind it: "People who like Minecraft also like beabadoobee." */
export function askMePlain(twin: Fingerprint["twin"], because?: string): string {
  if (!twin) return "";
  return because ? `Larry found that people who like ${because} also like ${twin.entity.name}.` : `A real pick Larry found from your ${lower(twin.fromDomain)} side.`;
}

/* ---------------------------------------------------------------- Larry's caption */

/** A tiny stable hash, so one card always gets the same fallback line (no flicker between visits). */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Larry's fixed caption when the model can't run. Grounded only in the real numbers and names, a
 * few shapes so two cards rarely read the same.
 */
export function fallbackCaption(fp: Fingerprint, opts: { name?: string; because?: string; seed?: string } = {}): string {
  const pct = fp.offBeatenPct;
  const top = fp.strongest[0];
  const twin = fp.twin;
  const lead =
    pct === undefined
      ? top
        ? `A ${lower(top)} heart through and through.`
        : "A card with its own mind."
      : pct >= 60
        ? "You found the quiet corners before they were cool."
        : pct >= 30
          ? "Half crowd favourites, half secret finds."
          : "You like the big hits, and you like them loudly.";
  const tails = twin
    ? [
        `Your next ${lower(twin.toDomain)} crush might be ${twin.entity.name}.`,
        `Larry thinks ${twin.entity.name} is waiting for you.`,
        `${twin.entity.name} feels like your kind of thing.`,
      ]
    : top
      ? [`Mostly ${lower(top)}, no apologies.`, `${label(top)} first, always.`]
      : [];
  const tail = tails.length ? tails[seedOf(opts.seed ?? opts.name ?? "") % tails.length] : "";
  return [lead, tail].filter(Boolean).join(" ");
}

const EMOJI = /\p{Extended_Pictographic}/u;
const URLISH = /(?:https?:\/\/|www\.|@|\.com\b|\.org\b|\.net\b)/i;
const GENDERED = /\b(?:he|she|him|her|hers|his|himself|herself)\b/i;
const COMMON_CAPS = new Set(["i", "i'm", "you", "your", "you're", "larry", "qloo", "ai"]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when every capitalised word (after a sentence's first) belongs to an allowed name, so the
 * caption never invents a title, place or person.
 */
export function mentionsOnly(text: string, allowed: string[]): boolean {
  let rest = ` ${text.replace(/[’‘]/g, "'")} `;
  for (const name of [...allowed].filter(Boolean).sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name.replace(/[’‘]/g, "'"))}(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1 _ ");
  }
  for (const sentence of rest.split(/[.!?:;]+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");
      if (w && /^\p{Lu}/u.test(w) && !COMMON_CAPS.has(w.toLowerCase())) return false;
    }
  }
  return true;
}

/**
 * Larry's caption when it passes every check, else null: short, plain, no emoji, links or
 * gendered words, only the real names, no number but the real percentage, and share-safe.
 */
export function validCaption(raw: unknown, allowedNames: string[], pct?: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > CAPTION_MAX_CHARS || text.split(" ").length > CAPTION_MAX_WORDS) return null;
  if (EMOJI.test(text) || URLISH.test(text) || GENDERED.test(text) || /[&·<>{}[\]*_#`|!]/.test(text)) return null;
  const numbers = text.match(/\d+/g) ?? [];
  if (numbers.some((n) => pct === undefined || Number(n) !== pct)) return null;
  const labels = Object.values(DOMAIN_STYLE).map((s) => s.label);
  if (!mentionsOnly(text, [...allowedNames, ...labels])) return null;
  return shareSafe(text, { names: allowedNames }) ? text : null;
}

/* ---------------------------------------------------------------- share-image safety */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/, // 30/10/2026, 2026-10-30
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b`, "i"), // 30 Oct
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"), // Oct 30
  /\b(?:19|20)\d{2}\b/, // a year
  /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b/i, // a weekday
  /\b(?:today|tonight|yesterday|tomorrow)\b/i,
  /\b\d{1,2}(?::\d{2})\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/i, // a time
];

/** Every title word and Glory: never on a shared image (they would tie the image to places). */
export const TITLE_WORDS: readonly string[] = [
  ...[...STAGES, ...PUBLIC_TITLES, ...FRIEND_RANK_TITLES, "host" as const].map((id) => TITLES[id].word),
  GLORY.word,
];

/** What a share line is checked against: the person's own venue names, and the real item names allowed in it. */
export interface ShareContext {
  /** Places from the device (steps, check-ins, tickets): never on an image. */
  venues?: readonly string[];
  /**
   * Real item names on the image (picks, bridges, the twin). A title word inside one is fine
   * ("The Legend of Zelda", "Blade Runner 2049"), so these are taken out before the checks.
   */
  names?: readonly string[];
}

/**
 * True when a line may go on a shared image: no title, no Glory, no date or time, and none of the
 * person's venue names. Also used on Larry's caption.
 */
export function shareSafe(line: string, ctx: ShareContext = {}): boolean {
  let text = line.normalize("NFKC");
  const flat = text.toLowerCase();
  for (const v of ctx.venues ?? []) {
    const name = v.normalize("NFKC").trim().toLowerCase();
    if (name.length >= 3 && flat.includes(name)) return false;
  }
  for (const n of [...(ctx.names ?? [])].sort((a, b) => b.length - a.length)) {
    if (n.trim().length >= 2) text = text.replace(new RegExp(escapeRe(n.normalize("NFKC").trim()), "gi"), " ");
  }
  for (const w of TITLE_WORDS) if (new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(text)) return false;
  return !DATE_PATTERNS.some((re) => re.test(text));
}

/** The lines a share image draws: only those that pass shareSafe (unsafe ones are dropped, never drawn). */
export function safeLines(lines: (string | undefined | null)[], ctx: ShareContext = {}): string[] {
  return lines.map((l) => (l ?? "").trim()).filter((l) => l && shareSafe(l, ctx));
}

export interface FingerprintShare {
  title: string;
  /** "4 of my 6 picks are outside Qloo's top 10%." or empty. */
  stat: string;
  /** The Ask-me line. */
  twin: string;
  /** Its plain line. */
  twinPlain: string;
  caption: string;
  /** "Talk to someone, not something." */
  subtitle: string;
}

/** The share image's subtitle (qloo-hooks-plan 3.2). */
export const SHARE_SUBTITLE = "Talk to someone, not something.";
/**
 * Where the share image's QR goes: making your OWN card. Never /join or /pair, never a link to the
 * sharer: an image posted online must not become an open invite. Only the live, expiring group QR
 * connects people.
 */
export const MAKE_YOUR_OWN_PATH = "/create";
export const MAKE_YOUR_OWN_LABEL = "Scan to make your own card";
/** The share link for an origin: always the make-your-own page, carrying nothing about the sharer. */
export const makeYourOwnLink = (origin: string) => `${origin.replace(/\/$/, "")}${MAKE_YOUR_OWN_PATH}`;

/**
 * Every word on the Fingerprint share image. Built only from the card name, the count, the twin
 * and Larry's caption; each passes shareSafe or is blanked. No "Your places", venues, titles,
 * Glory, dates, mood, age or rung can reach it.
 */
export function fingerprintShareText(fp: FingerprintView, name: string, venues: readonly string[] = []): FingerprintShare {
  const ctx = { venues, names: [fp.twin?.entity.name, fp.twinBecause].filter((n): n is string => !!n) };
  const keep = (s: string) => (s && shareSafe(s, ctx) ? s : "");
  return {
    title: keep(name ? `${name}'s Taste Fingerprint` : "My Taste Fingerprint"),
    stat: keep(lessKnownLine(fp.lessKnown, "my")),
    twin: keep(askMeLine(fp.twin)),
    twinPlain: keep(askMePlain(fp.twin, fp.twinBecause)),
    caption: keep(fp.caption ?? ""),
    subtitle: SHARE_SUBTITLE,
  };
}

/** What the "Our overlap" image shows after a pair session: two first names and what Qloo found. */
export interface OverlapData {
  names: [string, string];
  /** Things both picked. */
  shared: string[];
  /** Things Qloo thinks both would like (bridges), best first. */
  bridges: string[];
}

export interface OverlapShare {
  title: string;
  count: string;
  things: string[];
}

/** Every word on the overlap image: the two names, a true count and up to 3 real items. No venues. */
export function overlapShareText(o: OverlapData, venues: readonly string[] = []): OverlapShare {
  const ctx = { venues, names: [...o.shared, ...o.bridges] };
  const keep = (s: string) => (s && shareSafe(s, { venues }) ? s : "");
  const [a, b] = o.names;
  const shared = o.shared.length;
  const bridges = o.bridges.length;
  const count = [shared ? `${shared} you both picked` : "", bridges ? `${bridges} you might both like` : ""].filter(Boolean).join(" · ");
  return {
    title: keep(`${a} and ${b}: our overlap`),
    count: keep(count || "A fresh start: plenty to find together"),
    things: safeLines([...o.shared, ...o.bridges].slice(0, 3), ctx),
  };
}
