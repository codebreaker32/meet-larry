"use client";

import * as React from "react";
import type { SharedItem, WittyKind } from "@/lib/types/witty";

/**
 * Larry's own line for a home-card move or a quest name, written fresh from the REAL items behind it
 * (2F's witty engine: POST /api/witty { kind, items } -> { line, plain, source }). The move's
 * deterministic line shows first and stays whenever the model, the route or the budget isn't there,
 * so the card never waits and never invents. One request per move per visit (session cache).
 */
export const LARRY_LINE_ENDPOINT = "/api/witty";
const LINE_MAX = 220;
const CACHE_PREFIX = "larry.home.line.";

export interface LarryLine {
  line: string;
  plain: string;
  /** True when Larry (the model) wrote it; false for the fixed fallback. */
  fresh: boolean;
}

function readCache(key: string): LarryLine | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as LarryLine) : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, v: LarryLine) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(v));
  } catch {
    // Private mode: the next visit simply asks again.
  }
}

/** Accept only a short, plain line that names nothing outside the given items' text (2F validates the rest). */
export function acceptLine(body: unknown): { line: string; plain: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { line?: unknown; plain?: unknown; source?: unknown };
  if (b.source !== "model") return null;
  const line = typeof b.line === "string" ? b.line.replace(/\s+/g, " ").trim() : "";
  const plain = typeof b.plain === "string" ? b.plain.replace(/\s+/g, " ").trim() : "";
  if (!line || line.length > LINE_MAX || /https?:|www\./i.test(line)) return null;
  return { line, plain: plain && plain.length <= LINE_MAX ? plain : line };
}

export function useLarryLine(kind: WittyKind, items: SharedItem[], fallback: { line: string; plain: string }): LarryLine {
  const names = items.map((i) => i.name.trim()).filter(Boolean);
  const key = names.length ? `${kind}:${names.join("|")}` : "";
  const [got, setGot] = React.useState<{ key: string; v: LarryLine } | null>(null);
  const body = key ? JSON.stringify({ kind, items }) : "";
  // The home card renders on the client only, so the session cache can be read while rendering.
  const cached = React.useMemo(() => (key ? readCache(key) : null), [key]);

  React.useEffect(() => {
    if (!key || cached) return;
    const ctrl = new AbortController();
    fetch(LARRY_LINE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const ok = acceptLine(b);
        if (!ok) return;
        const v = { ...ok, fresh: true };
        writeCache(key, v);
        setGot({ key, v });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [key, body, cached]);

  if (got && got.key === key) return got.v;
  return cached ?? { ...fallback, fresh: false };
}
