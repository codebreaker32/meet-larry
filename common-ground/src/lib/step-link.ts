import { base64UrlToText, textToBase64Url } from "./base64url";
import { cleanName } from "./sanitize";
import type { StepKind } from "./types";

// A First Step can travel in a link: /steps?add=<value>. The value is base64url JSON
// {k: kind, t: text, w?: withName}. It is untrusted, so decoding checks and cleans every field.

export const STEP_TEXT_MAX = 140;

export interface StepLink {
  kind: StepKind;
  text: string;
  withPerson?: string;
}

const KINDS: readonly StepKind[] = ["go", "say", "show"];

function cleanStepText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\p{C}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STEP_TEXT_MAX)
    .trim();
}

/** The value for `/steps?add=...`. */
export function encodeStepLink(s: { kind: StepKind; text: string; withPerson?: string }): string {
  const packed: { k: StepKind; t: string; w?: string } = { k: s.kind, t: cleanStepText(s.text) };
  const w = s.withPerson ? cleanName(s.withPerson) : "";
  if (w) packed.w = w;
  return textToBase64Url(JSON.stringify(packed));
}

/** Parses and cleans a `?add=` value; null when it isn't a valid step. */
export function decodeStepLink(v: string): StepLink | null {
  try {
    const raw = JSON.parse(base64UrlToText(v)) as { k?: unknown; t?: unknown; w?: unknown };
    if (typeof raw !== "object" || raw === null) return null;
    if (typeof raw.k !== "string" || !KINDS.includes(raw.k as StepKind)) return null;
    if (typeof raw.t !== "string") return null;
    const text = cleanStepText(raw.t);
    if (!text) return null;
    const withPerson = typeof raw.w === "string" ? cleanName(raw.w) : "";
    return withPerson ? { kind: raw.k as StepKind, text, withPerson } : { kind: raw.k as StepKind, text };
  } catch {
    return null;
  }
}
