// Shared by client and server: the crisis check needs no model call, so it runs everywhere a
// person's words arrive, including "Just us" lines that never reach the server on their own.
import { type PairChatResult, MESSAGE_MAX } from "./chat-protocol";
import type { GroupChatResult } from "./contracts";

// Checked on every message before the model is called. Phrases, not single words, so
// "this game is killing me" or "I died laughing" don't trigger it.
const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid(e|al)\b(?! squad)/,
  /\bkill(ing)? my ?self\b/,
  /\bkms\b/,
  /\bunalive\b/,
  /\b(want(ed)? to|wanna|going to|gonna) die\b/,
  /\bfeel(ing)? like dying\b/,
  /\bhang(ing)? my ?self\b/,
  /\bi (want|wanna|need) to end it\b/,
  /\bi('ve| have)? been (cutting|hurting) (my ?self|again)\b/,
  /\bwish i (was|were) dead\b/,
  /\bwish i (wasn'?t|was not|weren'?t) (alive|here|born)\b/,
  /\b(end|ending) it all\b/,
  /\b(end|ending|take|taking) my (own )?life\b/,
  /\b(hurt|hurting|harm|harming|cut|cutting) my ?self\b/,
  /\bself[- ]?harm/,
  /\bno reason to (live|go on|be here)\b/,
  /\b(don'?t|do not|no longer) want to (live|be alive|be here( anymore)?|exist)\b/,
  /\b(i'?d|i would|everyone'?d|everyone would|they'?d|they would) be better off (dead|without me)\b/,
  /\bi'?m better off dead\b/,
  /\b(no ?one|nobody) would (care|notice) (if i|about me)\b/,
  /\b(no ?one|nobody) would miss me\b/,
  /\b(don'?t|do not|can'?t|cannot) see (the|any) point\b(?!\s+(of|in|to)\s+(?!(living|life|anything|going on|being alive|being here|trying)\b))/,
  /\bcan'?t (go on|do this anymore|take it anymore)\b/,
  /\b(took|take|taking) an overdose\b/,
  /\boverdos(e|ing) on\b/,
];

/** True when the text looks like someone may be in crisis. */
export function looksLikeCrisis(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/^\s*\[[^\]]*\]\s*/, "");
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

export const CRISIS_TEXT = `I'm an AI, so I can't help with this the way a person can. You matter. Please talk to someone you trust, or a helpline. Tap "Need help now?" at the top to find one near you.`;

/** Fixed reply for a possible crisis. The model is not called. */
export function crisisResult(): PairChatResult {
  return { messages: [{ from: "larry", text: CRISIS_TEXT }], quiet: false, steps: [], profileUpdates: [], crisis: true };
}

/**
 * Every message from a person since Larry last spoke, read straight from the raw body so the
 * crisis check needs nothing else to be valid. "Just us" lines arrive here as user turns in the
 * history, so the newest turn alone isn't enough: a crisis line two turns back must still be
 * caught. Same cut as the schema (MESSAGE_MAX * 2), so both see the same text.
 */
function unansweredUserTexts(body: unknown): string[] {
  return unansweredInHistory((body as { history?: unknown } | null)?.history);
}

/**
 * User turns after the last assistant turn, newest first. A "[quiet]" reply counts as Larry having
 * answered: the turns before it were checked when that request came in.
 */
function unansweredInHistory(history: unknown): string[] {
  if (!Array.isArray(history)) return [];
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i] as { role?: unknown; content?: unknown } | null;
    if (t?.role === "assistant") break;
    if (t?.role === "user" && typeof t.content === "string") out.push(t.content.slice(0, MESSAGE_MAX * 2));
  }
  return out;
}

/** True when any message since Larry last spoke looks like a crisis. Reads the raw request body. */
export function unansweredCrisis(body: unknown): boolean {
  return unansweredUserTexts(body).some(looksLikeCrisis);
}

/**
 * Same check on a history the server already holds (group rooms, solo chat): true when
 * any person's turn since Larry last replied looks like a crisis, "Just us" turns included.
 */
export function crisisInHistory(history: readonly { role: string; content: string }[]): boolean {
  return unansweredInHistory(history).some(looksLikeCrisis);
}

/** Fixed help reply for group and solo chat. The model is not called. */
export function groupCrisisResult(): GroupChatResult {
  return { messages: [{ from: "larry", text: CRISIS_TEXT }], quiet: false, steps: [], profileUpdates: [], crisis: true };
}
