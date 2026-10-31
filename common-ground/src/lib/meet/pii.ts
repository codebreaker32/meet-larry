import "server-only";
import { type DetectPii, detectPii, type PiiKind } from "@/lib/aws/pii";
import { detectRedFlag, type RedFlag } from "./red-flags";

// The safety watch on a chat message (Open to meet chats and groups, D21 and D22):
//  1. The regex red flags (red-flags.ts): free, instant, always on.
//  2. Amazon Comprehend DetectPiiEntities (src/lib/aws/pii.ts) when the regex found nothing: phone
//     numbers, emails, handles, links, street addresses, card and ID numbers, also written out in
//     ways the regex misses. If AWS is not set up, slow or down, the regex answer stands (fails open).
// The text is never stored or logged here. The answer says only what kind of thing was found, so
// Larry can step in warmly ("Let's keep numbers and addresses out of here for now. Meet at the place first.").

/** What Larry steps in about in a chat (same words as src/lib/groups/safety.ts). */
export type SafetyFlag = "contact" | "address" | "money" | "pressure";

export interface MessageSafety {
  /** null: nothing to step in about. */
  flag: SafetyFlag | null;
  /** A short, plain reason ("contact details"); never the text. */
  reason?: string;
  /** The finer red flag (e.g. "id", "insult", "age"), for callers that word it themselves. */
  redFlag?: RedFlag;
  /** Larry's warm step-in line. */
  line?: string;
  /** Which check found it. */
  source?: "regex" | "comprehend";
}

export interface SafetyOpts {
  /** The chat is new, so asking for numbers or socials counts too (default true). */
  early?: boolean;
  /** The public venue (if any), named in the step-in line and never mistaken for an address. */
  venue?: string;
  /** Stand-in for Comprehend, for tests. */
  detect?: DetectPii;
}

const FLAG_OF: Record<RedFlag, SafetyFlag | null> = {
  contact: "contact",
  id: "contact",
  address: "address",
  money: "money",
  private: "pressure",
  insult: "pressure",
  // Ages can come up between friends; Open to meet chats handle it themselves (rooms service).
  age: null,
};

const REASON: Record<RedFlag, string> = {
  contact: "contact details",
  id: "an ID or card number",
  address: "an address",
  money: "money",
  private: "going somewhere private",
  insult: "unkind words",
  age: "age",
};

const PII_FLAG: Record<PiiKind, RedFlag> = { contact: "contact", address: "address", payment: "money", id: "id" };

/** Larry's line for a flag, warm and short; names the venue when there is one. Pure. */
export function safetyLine(flag: RedFlag, venue?: string): string {
  const place = venue ? `Meet at ${venue} first.` : "Meet at the place first.";
  switch (flag) {
    case "contact":
    case "address":
      return `Let's keep numbers and addresses out of here for now. ${place}`;
    case "id":
      return "ID and card numbers can stay safely in your pocket. Nobody here needs them.";
    case "money":
      return "Money stays out of this chat. Nobody here needs you to send, lend or pay anything. Plans on Larry never cost a thing.";
    case "private":
      return venue ? `Let's keep it public. If you meet, meet at ${venue}, where other people are around.` : "Let's keep it public. A busy, open place is the best first meet.";
    case "insult":
      return "Let's keep it kind. Anyone can leave, block or report at any time.";
    case "age":
      return "Ages don't need to come up. Tell each other about the thing you share instead.";
  }
}

const result = (red: RedFlag, source: "regex" | "comprehend", venue?: string): MessageSafety => {
  const flag = FLAG_OF[red];
  return flag ? { flag, reason: REASON[red], redFlag: red, line: safetyLine(red, venue), source } : { flag: null, redFlag: red, source };
};

/**
 * Checks one chat message. Regex first; then Comprehend when the regex found nothing. Never
 * throws, never logs the text. `{ flag: null }` means nothing to step in about.
 */
export async function checkMessageSafety(text: string, opts: SafetyOpts = {}): Promise<MessageSafety> {
  const early = opts.early ?? true;
  const msg = typeof text === "string" ? text : "";
  if (!msg.trim()) return { flag: null };
  try {
    const red = detectRedFlag(msg, early);
    if (red && FLAG_OF[red]) return result(red, "regex", opts.venue);
    const hits = await detectPii(msg, { ...(opts.detect ? { detect: opts.detect } : {}), ...(opts.venue ? { ignore: [opts.venue] } : {}) });
    for (const kind of ["payment", "id", "address", "contact"] as const) {
      if (!hits?.some((h) => h.kind === kind)) continue;
      // Later in a chat, swapping contacts is the two people's own choice (as in the regex check).
      if (kind === "contact" && !early) continue;
      return result(PII_FLAG[kind], "comprehend", opts.venue);
    }
    return red ? result(red, "regex", opts.venue) : { flag: null };
  } catch {
    return { flag: null };
  }
}
