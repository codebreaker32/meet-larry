"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/rate-limit";
import { ACCESS_TEXT } from "./shared";
import { checkCode, looksLikeAccountCode, recordMiss, tooManyMisses } from "./index";

export type VerifyResult =
  | { ok: true; code: string; /** Share of the code's AI time still left, 0 to 1. */ left: number }
  | { ok: false; error: string };

/**
 * Checks a code someone typed on /code or in the access-code prompt. Returns only what the form
 * shows: the canonical code and roughly how much AI time is left. Wrong guesses are limited per client.
 */
export async function verifyAccessCode(raw: string): Promise<VerifyResult> {
  const typed = typeof raw === "string" ? raw.slice(0, 60) : "";
  if (!typed.trim()) return { ok: false, error: "Type your code first." };
  if (looksLikeAccountCode(typed)) return { ok: false, error: ACCESS_TEXT.invalid };
  const ip = `code:${clientIp(new Request("http://local/", { headers: await headers() }))}`;
  if (tooManyMisses(ip)) return { ok: false, error: "Too many wrong codes. Wait a few minutes, then try again." };
  try {
    const c = await checkCode(typed);
    if (c.ok) return { ok: true, code: c.code, left: c.budgetCents > 0 ? Math.max(0, 1 - c.spentCents / c.budgetCents) : 0 };
    if (c.state === "invalid") recordMiss(ip);
    return { ok: false, error: c.state === "spent" ? "This code has used its Larry time. Try another code." : ACCESS_TEXT.invalid };
  } catch (err) {
    console.error("Access code check failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't check the code right now. Try again in a minute." };
  }
}
