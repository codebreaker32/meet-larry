// Red flags in a meet chat (PRODUCT.md, Open to meet): asking for addresses, pressure to go
// somewhere private, age questions, insults, asking for money or payment details (persona
// walkthrough, Rohan and Anjali; user-research R11), and asking for numbers or socials early on. A match
// makes Larry step in with a fixed, kind line straight away: no model call, so it always works,
// even when the AI budget is spent. Plain module: no server-only imports, so it is easy to test.

/** "id": an ID or card number (found by Amazon Comprehend, see src/lib/meet/pii.ts). */
export type RedFlag = "private" | "address" | "age" | "insult" | "money" | "contact" | "id";

const PATTERNS: [RedFlag, RegExp][] = [
  [
    "private",
    /\b(my|your|ur)\s+(place|flat|apartment|house|room|car|hotel|bedroom)\b|\bcome\s+(over|back\s+with\s+me|to\s+mine)\b|\bback\s+to\s+(mine|my\s+place|yours)\b|\bsomewhere\s+(private|more\s+private|quiet(er)?\s+(just\s+)?(us|alone)|alone|else\s+(just\s+)?(us|alone))\b|\balone\s+together\b|\bjust\s+(the\s+)?two\s+of\s+us\s+alone\b|\bleave\s+with\s+me\b|\bget\s+in\s+(my|the)\s+car\b|\b(let'?s|we\s+should)\s+go\s+somewhere\s+else\b/,
  ],
  [
    "address",
    /\bwhere\s+(do|did)\s+(you|u)\s+(live|stay)\b|\bwhere\s+(you|u)\s+(live|stay)\b|\b(your|ur|home|house)\s+address\b|\bwhich\s+(street|road|flat|apartment|building|block)\b|\bwhere('?s|\s+is)\s+(your|ur)\s+(house|home|place|flat)\b|\b(your|ur)\s+post\s*code\b|\bwhat\s+area\s+do\s+(you|u)\s+live\b/,
  ],
  [
    "age",
    /\bhow\s+old\s+(are\s+)?(you|u)\b|\b(your|ur)\s+age\b|\bwhat\s+year\s+were\s+(you|u)\s+born\b|\bare\s+(you|u)\s+(even\s+|really\s+)?(18|eighteen|legal|underage|a\s+minor)\b|\b(you|u)\s+look\s+(so\s+|really\s+)?young\b|\bwhat\s+(school|grade)\b|\bstill\s+in\s+school\b/,
  ],
  [
    "insult",
    /\b(fuck\s+(you|off)|stfu|kys|kill\s+yourself|bitch|slut|whore|cunt|retard(ed)?)\b|\b(you('?re|\s+are)?|ur|u\s+r|what\s+an?|such\s+an?)\s+(an?\s+|so\s+|such\s+an?\s+)?(idiot|stupid|dumb|moron|loser|ugly|fat|freak|pathetic|worthless|creep|weirdo)\b|\bshut\s+up\b/,
  ],
  [
    "money",
    /\b(lend|loan|send|give|transfer|pay|wire)\s+(me\s+|us\s+)?(some\s+|a\s+(little|bit\s+of)\s+)?(money|cash|funds|rs\.?|rupees|inr|dollars|pounds|\$|₹|£)|\b(lend|loan|send|transfer|pay)\s+(me\s+|us\s+)?[$₹£]?\s?\d|\bborrow\s+(some\s+)?(money|cash)\b|\b(need|want)\s+(some\s+)?(money|cash)\s+(from\s+(you|u)|urgently|now)\b|\bcan\s+(you|u)\s+(pay|cover|spot)\s+(for\s+)?me\b|\b(your|ur)\s+(upi|gpay|google\s+pay|paytm|phonepe|venmo|paypal|cash\s*app)\b|\b(upi|bank|card|account)\s+(id|details|number|pin)\b|\b(otp|one[\s-]time\s+(code|password))\b|\bgift\s+cards?\b|\b(gpay|paytm|phonepe|upi|venmo|paypal)\s+me\b|\b(bitcoin|btc|crypto|usdt|forex|trading\s+(app|account|group))\b|\b(invest|investment)\s+(with|in|through)\s+(me|my)\b|\bdouble\s+(your|ur)\s+money\b/,
  ],
  [
    "contact",
    /\b(phone|mobile|cell)\s*(number|no\b|#)|\b(your|ur)\s+(number|digits|phone|insta|instagram|snap|snapchat|whatsapp|telegram|discord|socials?|handle|tiktok|e-?mail|facebook|fb)\b|\b(whats\s*app|snapchat|instagram|insta|telegram|discord|tiktok|kik)\b|\b(dm|text|call|add|follow)\s+me\b|\bgive\s+me\s+your\b|(^|\s)@[a-z0-9_.]{3,}|\b\d[\d\s().-]{7,}\d\b|[\w.+-]+@[\w-]+\.[a-z]{2,}/,
  ],
];

/**
 * The first red flag in a message, or null. `early`: the chat is new, so asking for a number or
 * socials counts too (later on, swapping contacts is the two people's own choice).
 */
export function detectRedFlag(raw: string, early = true): RedFlag | null {
  const text = raw.normalize("NFKC").toLowerCase().replace(/[’`]/g, "'").slice(0, 2000);
  for (const [flag, re] of PATTERNS) {
    if (flag === "contact" && !early) continue;
    if (re.test(text)) return flag;
  }
  return null;
}

/** What Larry says when it steps in. Short, kind, easy-read, and always about the public venue. */
export function stepInText(flag: RedFlag, venue: string): string {
  switch (flag) {
    case "private":
      return `Let's keep it public. If you two meet, meet here at ${venue}, where other people are around. Nobody has to go anywhere else.`;
    case "address":
      return `Let's keep home addresses out of this chat. If you two meet, meet here at ${venue}, out in the open.`;
    case "age":
      return "You both said you are 18 or over, so ages don't need to come up. Tell each other about the thing you share instead.";
    case "money":
      return "Money stays out of this chat. Nobody here should ask you to send, lend or pay anything. If it feels off, tap the shield button to block.";
    case "insult":
      return "Let's keep it kind. Anyone can leave, block or report at any time with the shield button.";
    case "contact":
      return `It's early to swap numbers or socials. Keep chatting here for now. If it goes well, you can meet at ${venue}.`;
    case "id":
      return "ID and card numbers can stay safely in your pocket. Nobody here needs them. Tell each other about the thing you share instead.";
  }
}
