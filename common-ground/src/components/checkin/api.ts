"use client";

import { apiFetch } from "@/lib/api-client";
import type { ArriveRefusal } from "@/lib/checkins";
import { getPreciseFix, locationPermission } from "@/lib/location";
import { deviceId } from "@/lib/meet/client";
import type { Mood } from "@/lib/types/signals";
import type { ArriveResponse, LeaveResponse } from "@/lib/types/checkin";
import type { WittyResult } from "@/lib/types/witty";

// The check-in sheet's calls. Each tap reads one fresh precise fix (no prompt: location was asked
// once at onboarding, D24), sends it, and forgets it. With no fix at all the request still goes,
// marked as unusable, so the server decides: only the demo/testing account skips the location
// check (D19), everyone else gets a warm "can't tell where you are" answer.

type FixBody = { lat: number; lon: number; accuracyM: number };
/** The schema's ceiling. A coarser fix (IP-based location reports 10-100 km) is sent as this, so the
 * server answers "fuzzy" warmly, and the demo account still gets through, instead of a 400. */
const MAX_ACCURACY_M = 5000;
/** Accuracy the server reads as "no usable fix" (anything worse than 300 m). */
const NO_FIX: FixBody = { lat: 0, lon: 0, accuracyM: MAX_ACCURACY_M };

/** Exported for tests: the body for one fix, clamped to what the server accepts. */
export function toFixBody(f: { lat: number; lon: number; accuracy: number }): FixBody {
  const acc = Number.isFinite(f.accuracy) && f.accuracy >= 0 ? Math.min(MAX_ACCURACY_M, Math.round(f.accuracy)) : MAX_ACCURACY_M;
  return { lat: f.lat, lon: f.lon, accuracyM: acc };
}

async function fixBody(): Promise<{ fix: FixBody; had: boolean }> {
  const f = await getPreciseFix();
  return f ? { fix: toFixBody(f), had: true } : { fix: NO_FIX, had: false };
}

const post = (path: string, body: unknown) =>
  apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type ArriveAnswer =
  | { ok: true; visitToken: string; dwellMs: number; placeName?: string }
  | { ok: false; reason: ArriveRefusal | "no-permission" | "error"; line?: string };

export async function arrive(placeId: string): Promise<ArriveAnswer> {
  try {
    const { fix, had } = await fixBody();
    const res = await post("/api/checkins/arrive", { placeId, ...fix, deviceId: deviceId() });
    const body = (await res.json().catch(() => ({}))) as Partial<ArriveResponse> & { placeName?: string; reason?: ArriveRefusal; error?: string };
    if (res.ok && typeof body.visitToken === "string") return { ok: true, visitToken: body.visitToken, dwellMs: Number(body.dwellMs) || 0, placeName: body.placeName };
    if (body.reason === "fuzzy" && !had && (await locationPermission()) === "denied") return { ok: false, reason: "no-permission" };
    return { ok: false, reason: body.reason ?? "error", line: body.error };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type LeaveAnswer = (LeaveResponse & { ok: true }) | { ok: false; reason: "expired" | "no-permission" | "error"; line?: string };

export async function leave(visitToken: string, saidHi: boolean): Promise<LeaveAnswer> {
  try {
    const { fix, had } = await fixBody();
    const res = await post("/api/checkins/leave", { visitToken, ...fix, ...(saidHi ? { saidHi: true } : {}) });
    const body = (await res.json().catch(() => ({}))) as Partial<LeaveResponse> & { reason?: string; error?: string };
    if (res.status === 410) return { ok: false, reason: "expired", line: body.error };
    if (!res.ok || typeof body.verified !== "boolean") return { ok: false, reason: "error", line: body.error };
    if (!body.verified && body.reason === "no-coords" && !had && (await locationPermission()) === "denied") return { ok: false, reason: "no-permission" };
    return { ok: true, verified: body.verified, gloryDelta: Math.max(0, Number(body.gloryDelta) || 0), ...(body.reason ? { reason: body.reason as LeaveResponse["reason"] } : {}) };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export interface PlaybackRequest {
  placeName: string;
  visits: number;
  stage?: string | null;
  stageEarned?: boolean;
  guess?: 1 | 2 | 3 | 4 | 5;
  reality?: 1 | 2 | 3 | 4 | 5;
  glad?: "yes" | "meh" | "no";
  saidHi?: boolean;
  mood?: Mood;
}

/** Larry's line for a counted visit; null when the call fails (the sheet then shows its own fixed line). */
export async function fetchPlayback(input: PlaybackRequest): Promise<WittyResult | null> {
  try {
    const res = await post("/api/checkins/playback", input);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<WittyResult>;
    return typeof body.line === "string" && typeof body.plain === "string" ? { line: body.line, plain: body.plain, source: body.source === "model" ? "model" : "fallback" } : null;
  } catch {
    return null;
  }
}
