"use client";

import type { GroupJoinTicket } from "./group-api";

// The creator's QR ticket, kept for this tab only (sessionStorage), so the chat page can keep showing
// the QR after "Start a group". It is never written to localStorage and disappears with the tab.
const KEY = "larry.group.join.";

export function readJoinTicket(groupId: string): GroupJoinTicket | null {
  try {
    const raw = sessionStorage.getItem(KEY + groupId);
    if (!raw) return null;
    const t = JSON.parse(raw) as GroupJoinTicket;
    return t && typeof t.token === "string" && typeof t.expiresAt === "number" && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}

export function saveJoinTicket(groupId: string, ticket: GroupJoinTicket | null) {
  try {
    if (ticket) sessionStorage.setItem(KEY + groupId, JSON.stringify(ticket));
    else sessionStorage.removeItem(KEY + groupId);
  } catch {
    /* private mode: the QR shows until the page reloads */
  }
}
