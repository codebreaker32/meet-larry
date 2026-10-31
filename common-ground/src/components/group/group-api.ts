"use client";

// The browser side of groups (D25, D26): every chat is a Group made by QR. The person who starts it
// picks the size (2 to 5 people, counting themselves), shows the QR, and whoever scans it (signed in,
// 18+) joins until it is full. Joining by QR is the consent; members are friends.
//
// Every call is signed with the Firebase ID token (authFetch, D18), so only accounts reach groups.
// The server decides membership; this file only shapes requests and easy-read errors.
import { authFetch } from "@/lib/firebase/client";
import { locationForRequest } from "@/lib/location";
import { recentPlacesField, signalsField } from "@/lib/mood";
import { personaForRequest } from "@/lib/persona";
import type { GroupGround, Persona, PersonaUpdate } from "@/lib/contracts";
import type { Profile } from "@/lib/types";
import {
  DEMO_FRIEND_LABEL,
  GROUP_WORD,
  type GroupCreateResponse,
  type GroupJoinResponse,
  type GroupJoinTicket,
  type GroupListResponse,
  type GroupMemberAction,
  type GroupMemberView,
  type GroupMessageView,
  type GroupPollResponse,
  type GroupPreviewResponse,
  type GroupReportReason,
  type GroupSize,
  type GroupSummary,
  type GroupView,
  joinTokenFromHash,
} from "@/lib/groups/shared";

export { DEMO_FRIEND_LABEL, GROUP_WORD, GROUP_SIZES, GROUP_QR_TTL_MS, GROUP_REPORT_REASONS, GROUP_COPY } from "@/lib/groups/shared";
export type {
  GroupGround,
  GroupMemberView,
  GroupMessageView,
  GroupView,
  GroupSummary,
  GroupSize,
  GroupReportReason,
  GroupJoinTicket,
  GroupPreviewResponse,
};

/** Lower-case, for the middle of a sentence. */
export const GROUP_WORD_LOWER = GROUP_WORD.toLowerCase();

/**
 * Where a group QR lands: /scan#t=<token>. The token rides in the fragment, which browsers never
 * send to a server, so it stays out of logs, Referer headers and analytics.
 */
export const SCAN_PATH = "/scan";
export const groupJoinLink = (origin: string, token: string) => `${origin}${SCAN_PATH}#t=${token}`;

/** Pulls the join token out of whatever someone pasted: a whole link (…/scan#t=… or …/g#t=…), or the bare token. */
export function tokenFromInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hashAt = s.indexOf("#");
  if (hashAt >= 0) return joinTokenFromHash(s.slice(hashAt));
  return /^[A-Za-z0-9_.-]{20,400}$/.test(s) ? s : null;
}

export class GroupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Warm, easy-read words for each failure: the server's own words when it sent some (they're shared copy). */
export function groupErrorText(status: number, serverText?: string): string {
  if (serverText) return serverText;
  if (status === 401) return `Sign in first, then open the ${GROUP_WORD_LOWER} again.`;
  if (status === 404) return `You're not in this ${GROUP_WORD_LOWER} any more.`;
  if (status === 409) return `This ${GROUP_WORD_LOWER} is full already. Ask them to start a new one.`;
  if (status === 410) return "This QR has run out of time. Ask for a fresh one.";
  if (status === 429) return "Lots of taps! Wait a moment, then try again.";
  return "Hmm, that didn't go through. Try again in a moment?";
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(url, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers as Record<string, string>) },
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new GroupError("No connection right now. Check your internet and try again.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GroupError(groupErrorText(res.status, typeof body.error === "string" ? body.error : undefined), res.status);
  return body as T;
}

const post = <T>(url: string, body: unknown = {}, signal?: AbortSignal) =>
  call<T>(url, { method: "POST", body: JSON.stringify(body), signal });

const idPath = (id: string) => `/api/groups/${encodeURIComponent(id)}`;

export const listGroups = (signal?: AbortSignal) => call<GroupListResponse>("/api/groups", { signal });

export const createGroup = (size: GroupSize, profile: Profile) =>
  post<GroupCreateResponse>("/api/groups", { size, profile, ...signalsField() });

export const previewGroup = (token: string, signal?: AbortSignal) =>
  post<GroupPreviewResponse>("/api/groups/join", { token, action: "preview" }, signal);

export const joinGroup = (token: string, profile: Profile) =>
  post<GroupJoinResponse>("/api/groups/join", { token, action: "join", profile, ...signalsField() });

export const getGroup = (id: string, since: number | undefined, signal?: AbortSignal) =>
  call<GroupPollResponse>(`${idPath(id)}${since === undefined ? "" : `?since=${since}`}`, { signal });

/** What a POST that changes the chat answers with: the fresh group and its messages. */
export type GroupState = { group: GroupView; messages: GroupMessageView[] };

/**
 * Posts a message. When it tags Larry, this phone's persona, mood, recent places and the coarse
 * area kept at onboarding (about 1 km, D24) go with it, so Larry can use them. None of it is shown to
 * the group, and distances never are. With no stored point, a silent read when the browser already
 * allows it (never a prompt). The point is never stored with the message.
 */
export async function sendGroupMessage(id: string, text: string, tagsLarry: boolean, persona?: Persona | null) {
  const area = tagsLarry ? await locationForRequest() : null;
  return post<Partial<GroupState> & { crisis?: true; personaUpdate?: PersonaUpdate; privateNote?: string; needsLocation?: true }>(`${idPath(id)}/messages`, {
    text,
    ...(area ? { location: { lat: area.lat, lon: area.lon } } : {}),
    ...(tagsLarry && persona ? { persona: personaForRequest(persona) } : {}),
    ...(tagsLarry ? { ...signalsField(), ...recentPlacesField() } : {}),
  });
}

/** The creator stops the QR at once. */
export const closeJoining = (id: string) => post<Partial<GroupState>>(`${idPath(id)}/joining`, { action: "close" });
/** The creator shows a fresh QR (cancels every earlier one). */
export const freshQr = (id: string) => post<{ join: GroupJoinTicket } & Partial<GroupState>>(`${idPath(id)}/joining`, { action: "open" });
export const leaveGroup = (id: string) => post<{ ok: true }>(`${idPath(id)}/leave`);

/** Remove (creator only), Unfriend, Block, Report: silent and immediate. */
export const memberAction = (id: string, action: GroupMemberAction, memberId: string, reason?: GroupReportReason) =>
  post<{ ok: true } & Partial<GroupState>>(`${idPath(id)}/members`, { action, memberId, ...(reason ? { reason } : {}) });

/** A demo friend the demo account can let "scan" its live QR (the server answers only the demo account). */
export interface DemoFriendOption {
  key: string;
  name: string;
  vibe: string;
  picks: string[];
}

/** The demo friends who can scan this QR now; a 404 (every account but the demo one) means none. */
export async function demoFriendOptions(id: string, signal?: AbortSignal): Promise<DemoFriendOption[]> {
  try {
    return (await call<{ friends: DemoFriendOption[] }>(`${idPath(id)}/demo-friends`, { signal })).friends ?? [];
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return [];
  }
}

/** The demo account lets one demo friend scan its live QR. Answers with the fresh group. */
export const demoFriendScan = (id: string, friend: string) => post<Partial<GroupState>>(`${idPath(id)}/demo-friends`, { friend });

/** A member's name with the Demo friend label when they are one (every member list and chat). */
export const memberLabel = (m: Pick<GroupMemberView, "name" | "isDemoFriend">) => (m.isDemoFriend ? `${m.name} (${DEMO_FRIEND_LABEL})` : m.name);

/** "Sam", "Sam and Priya", "Sam, Priya and Alex". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Group of 3" / "One-to-one". */
export const sizeLabel = (size: number) => (size === 2 ? "Just the two of you" : `${size} people`);
