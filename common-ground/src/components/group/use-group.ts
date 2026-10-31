"use client";

import * as React from "react";
import { GroupError, type GroupState, getGroup } from "./group-api";

const POLL_MS = 2000;
/** Failed polls in a row before "Reconnecting" shows (one blip is not worth a message). */
const FAILS_BEFORE_NOTICE = 3;

export type GroupGone = "removed";

/**
 * Polls one group every POLL_MS while the tab is visible (paused when hidden, so it never runs in
 * the background). Returns the latest group, a way to apply a POST answer, and its health. Polling
 * shows no read receipts, typing dots or online status: it only fetches the chat.
 */
export function useGroup(id: string, initial?: GroupState | null) {
  const [state, setState] = React.useState<GroupState | null>(initial ?? null);
  const [offline, setOffline] = React.useState(false);
  const [gone, setGone] = React.useState<GroupGone | null>(null);
  const versionRef = React.useRef<number | undefined>(initial?.group.version);

  /** Takes the group from a poll or a POST answer, never going back to an older version. */
  const apply = React.useCallback((next: Partial<GroupState> | null | undefined) => {
    if (!next?.group || !next.messages) return;
    if (versionRef.current !== undefined && next.group.version < versionRef.current) return;
    versionRef.current = next.group.version;
    setState({ group: next.group, messages: next.messages });
  }, []);

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let fails = 0;
    let ctrl: AbortController | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(tick, POLL_MS);
    };
    async function tick() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      ctrl = new AbortController();
      try {
        const out = await getGroup(id, versionRef.current, ctrl.signal);
        fails = 0;
        setOffline(false);
        if ("group" in out) apply(out);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (err instanceof GroupError && err.status === 404) {
          // Left, removed, unfriended or blocked: the chat closes at once on this phone too.
          stopped = true;
          setGone("removed");
          return;
        }
        fails += 1;
        if (fails >= FAILS_BEFORE_NOTICE) setOffline(true);
      } finally {
        inFlight = false;
        schedule();
      }
    }
    const onVisible = () => {
      if (document.hidden) clearTimeout(timer);
      else if (!inFlight) void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, apply]);

  return { group: state?.group ?? null, messages: state?.messages ?? [], apply, offline, gone };
}
