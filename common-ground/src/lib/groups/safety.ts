import "server-only";
import { checkMessageSafety } from "@/lib/meet/pii";
import { detectRedFlag } from "@/lib/meet/red-flags";

// The safety watch on every group message (D21, D22): 2F's checkMessageSafety (src/lib/meet/pii.ts,
// the regex red flags plus Amazon Comprehend, failing open to the regex). If that throws, the
// regex check here runs. Text is never logged or stored by this check.

export type SafetyFlag = "contact" | "address" | "money" | "pressure";
export interface SafetyResult {
  flag: SafetyFlag | null;
  reason?: string;
}
export type CheckMessageSafety = (text: string) => Promise<SafetyResult>;

/** The built-in check: the Open to meet red flags, mapped to the group flags. Never throws. */
export const regexSafety: CheckMessageSafety = async (text) => {
  const f = detectRedFlag(text, true);
  if (f === "contact" || f === "private") return { flag: "contact", reason: "contact details" };
  if (f === "address") return { flag: "address", reason: "an address" };
  if (f === "money") return { flag: "money", reason: "money" };
  return { flag: null };
};

/** The real watch: 2F's checkMessageSafety, reduced to the flag and its plain reason. */
export const fullSafety: CheckMessageSafety = async (text) => {
  const r = await checkMessageSafety(text);
  return { flag: r.flag, ...(r.reason ? { reason: r.reason } : {}) };
};

let current: CheckMessageSafety = fullSafety;

/** Swaps the check (tests). */
export function setMessageSafety(fn: CheckMessageSafety) {
  current = fn;
}

/** Runs the watch; any failure falls back to the regex check, then to no flag. */
export async function checkSafety(text: string, fn: CheckMessageSafety = current): Promise<SafetyResult> {
  try {
    return await fn(text);
  } catch {
    try {
      return await regexSafety(text);
    } catch {
      return { flag: null };
    }
  }
}

/** Larry stepping in, warm and short. Never names the person, never scolds. */
export const STEP_IN: Record<SafetyFlag, string> = {
  contact:
    "Quick tip from Larry: numbers and handles can wait until you've met up and feel sure. Plans can stay right here for now.",
  address:
    "Small tip from Larry: home addresses are best kept for later. A public spot works well for a first meet. Tag me with /plan and I'll find one.",
  money: "Friendly note from Larry: nobody here needs to send money. Making plans on Larry never costs anything.",
  pressure: "Larry here. Everyone goes at their own pace. Saying no is fine, and anyone can leave the group any time.",
};

/** One step-in per flag per group in this window. */
export const STEP_IN_COOLDOWN_MS = 10 * 60 * 1000;
