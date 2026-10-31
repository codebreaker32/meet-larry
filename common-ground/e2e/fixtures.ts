import { test as base, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { NextRungInput, NextRungResult, PlanBInput, PlanBResult, SuggestResult } from "../src/lib/contracts";
import type { Account, SyncBlob } from "../src/lib/types/account";
import type { ArriveResponse, LeaveResponse } from "../src/lib/types/checkin";
import type { Friend, FriendInvite, PodiumResponse } from "../src/lib/types/people";
import type { FriendProfile, OwnerProfile, ProfileData, StrangerProfile } from "../src/lib/types/profile";
import type { Fingerprint, MatchDay, RisingItem } from "../src/lib/types/signals-ui";

/** Fixed /api/suggest answer: steps for the end panel, nudges for practice. No model call. */
export const SUGGEST_STEPS: SuggestResult["steps"] = [
  { kind: "say", text: "Ask someone new what they're playing" },
  { kind: "show", text: "Show a friend the trailer for Jojo Rabbit" },
  { kind: "show", text: "Share your taste card in class" },
];
export const SUGGEST_NUDGES = ["Small hellos count.", "Ask one easy question.", "Curious beats clever."];

let ipCounter = 0;
/** A made-up client IP per test, so the server's per-IP rate limits never leak between tests. */
export const freshIp = () => `10.77.${process.pid % 250}.${(ipCounter++ % 250) + 1}`;

/**
 * Keeps every test away from the real model, whatever the page does. Routes registered later
 * (by the test itself) take precedence, so a test can still answer these its own way.
 *  - /api/suggest gets fixed steps or nudges.
 *  - /api/chat and /api/larry get a 503 unless the test mocks them.
 *  - Room messages to Larry carry the dev-only x-e2e-larry hook, so the server never runs the agent.
 */
/** A fixed "Larry" answer for the ladder's next rung: a real candidate, chosen the way Larry is told to. */
function fixedNextRung(input: NextRungInput): NextRungResult {
  const order = ["calm", "cosy", "lively"] as const;
  const from = order.indexOf(input.step.vibe ?? "calm");
  const want = input.reason === "too_loud" ? Math.max(0, from - 1) : input.feeling === "good" ? Math.min(2, from + 1) : input.feeling === "hard" ? Math.max(0, from - 1) : from;
  const pick = input.candidates.find((c) => c.vibe === order[want] && c.id !== input.step.placeId) ?? input.candidates.find((c) => c.vibe === order[want]);
  const to = pick ? order.indexOf(pick.vibe) : want;
  return {
    ...(pick ? { placeId: pick.id } : {}),
    vibe: order[to],
    move: to > from ? "up" : to < from ? "back" : "stay",
    why: pick ? `${pick.name} is quieter, with corners to sit and read.` : "Nothing nearby fits yet.",
    ...(input.reason === "too_loud" ? { learned: { addLikes: [], addDislikes: [], addNotes: ["finds loud places hard"], placeVibe: "calm" as const } } : {}),
    fallback: false,
  };
}

/** A fixed "Larry" plan B that uses the real place and item. */
function fixedPlanB(input: PlanBInput): PlanBResult {
  const item = input.item ? ` and bring up ${input.item.name}` : "";
  return { planB: `If I feel unsure, I'll go to ${input.place.name} for 10 minutes${item}.`, fallback: false };
}

export async function guardModel(target: Page | BrowserContext) {
  await target.route("**/api/suggest", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown> & { kind?: string };
    let result: unknown;
    if (body.kind === "next_rung") result = fixedNextRung(body as unknown as NextRungInput);
    else if (body.kind === "plan_b") result = fixedPlanB(body as unknown as PlanBInput);
    // The Plan Ticket's extras (Amazon hours, walk, second stop, Larry's lines): nothing new in tests.
    else if (body.kind === "ticket") result = { fallback: true };
    else
      result = (
        body.kind === "nudges" ? { steps: [], nudges: SUGGEST_NUDGES, fallback: false } : { steps: SUGGEST_STEPS, nudges: [], fallback: false }
      ) satisfies SuggestResult;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  // Rising writes one Larry line per item: fixed items here, unless a test answers it itself.
  await target.route("**/api/rising**", (route) => json(route, RISING));
  // The Fingerprint calls Qloo and the model: a fixed answer unless a test answers it itself.
  await target.route("**/api/fingerprint", (route) => json(route, { ...FINGERPRINT, caption: "Most of your picks skip the crowd.", captionSource: "fallback" }));
  for (const path of ["**/api/chat", "**/api/larry"]) {
    await target.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The model is not used in tests." }) }),
    );
  }
  await target.route("**/api/rooms/*/messages", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-e2e-larry": larryHeader({ text: "I'm Larry, an AI pal (test reply)." }),
        // Larry in a room needs an access code; the test hook above means nothing is spent.
        ...accessHeader(),
      },
    }),
  );
}

/** This run's access code (e2e/global-setup.ts) as a request header. */
export const accessHeader = (): Record<string, string> => (process.env.E2E_CODE ? { "x-larry-code": process.env.E2E_CODE } : {});

/** The value of the dev-only x-e2e-larry header: Larry's reply for one room message. */
export const larryHeader = (reply: { text?: string; steps?: unknown[]; places?: unknown[]; echo?: boolean }) => encodeURIComponent(JSON.stringify(reply));

/** Room tests add this to every request: fake Qloo for group ground, and a made-up IP. */
export const roomHeaders = (): Record<string, string> => ({ "x-real-ip": freshIp(), "x-e2e-fake-qloo": "1", ...accessHeader() });

/**
 * Dev-only header on every request from a test page: routes that call the model through wittyLine
 * (2F) or write Larry lines (Rising, 2E) answer from their fixed fallbacks instead. Like the room
 * hooks, it is honoured only when NODE_ENV is "development" and ignored in a production build.
 */
export const E2E_NO_MODEL_HEADER = "x-e2e-no-model";

export const test = base.extend<{ guard: void }>({
  // (The second argument is Playwright's "use"; named so React's hook lint rule leaves it alone.)
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-real-ip": freshIp(), [E2E_NO_MODEL_HEADER]: "1" });
  },
  guard: [
    async ({ context }, provide) => {
      await guardModel(context);
      await provide();
    },
    { auto: true },
  ],
});

export { expect };

/* ================================================================ final build contracts (0D)
 * Fixed answers for every new route in final-build-plan section 4, so a spec can mock the routes it
 * does not test. Only Rising is mocked automatically (it calls the model); the rest are opt-in with
 * mockContracts(), because the builders who own those routes test them for real.
 * Spec-only mocks go inside the spec file; this file is frozen after Stage 0.
 */

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * The one Firebase test number (the demo account, D19) and its code, read from env DEMO_PHONE and
 * DEMO_CODE (.env only, never in the repo). Empty when not set; specs use the fake e2e token instead.
 */
export const DEMO_PHONE = process.env.DEMO_PHONE ?? "";
export const DEMO_CODE = process.env.DEMO_CODE ?? "";

/** The fake ID token the e2e sign-in returns (accepted only with E2E=1 outside production). */
export const e2eToken = (uid: string) => `e2e:${uid}`;
/** An Authorization header for API calls made from a spec. */
export const bearer = (uid: string): Record<string, string> => ({ authorization: `Bearer ${e2eToken(uid)}` });

export const CAFE = { placeId: "E2E00000-0000-4000-8000-0000000000C1", placeName: "Dice and Tea Board Game Cafe" } as const;

export const ACCOUNT: Account = {
  uid: "e2e-user-1",
  name: "Sam",
  username: "QuietOtter42",
  createdAt: Date.UTC(2026, 9, 30),
  budgetCentsLeft: 25,
  glory: 30,
  sharingWithFriends: false,
  showOnLeaderboards: true,
  publicTitleCounts: { "final-boss": 1 },
};

export const ARRIVE: ArriveResponse = { visitToken: "e2e.visit.token.0000000000", dwellMs: 2000 };
export const LEAVE: LeaveResponse = { verified: true, gloryDelta: 10 };

export const PODIUM: PodiumResponse = {
  placeId: CAFE.placeId,
  open: true,
  participants: 3,
  entries: [
    { rank: 1, title: "final-boss", alias: "MossyLantern7" },
    { rank: 2, title: "guildmaster", alias: "BraveHeron31" },
    { rank: 3, title: "shogun", alias: "CalmWalrus12" },
  ],
};

export const STRANGER_PROFILE: StrangerProfile = { viewer: "stranger", username: "QuietOtter42", publicTitles: [{ title: "final-boss", places: 1 }] };
export const FRIEND_PROFILE: FriendProfile = {
  viewer: "friend",
  username: "QuietOtter42",
  displayName: "Sam",
  glory: 30,
  publicTitles: [{ title: "final-boss", venue: CAFE }],
  friendTitles: [{ title: "party-leader", venue: CAFE }],
  timesMet: 0,
  sharing: true,
};
export const OWNER_PROFILE: OwnerProfile = {
  viewer: "owner",
  username: "QuietOtter42",
  displayName: "Sam",
  glory: 30,
  places: [{ venue: CAFE, stage: "rookie", visits: 2, weeks: 2, nextStage: { stage: "regular", visitsAway: 1 } }],
  publicTitles: [{ title: "final-boss", venue: CAFE, alias: "MossyLantern7" }],
  friendTitles: [{ title: "party-leader", venue: CAFE }],
  sharingWithFriends: false,
  showOnLeaderboards: true,
  rivalry: "1 visit until Party Leader at Dice and Tea Board Game Cafe.",
};

export const FRIENDS: Friend[] = [{ uid: "e2e-guest-2", username: "BraveHeron31", displayName: "Priya", sharing: true }];
export const INVITE: FriendInvite = { code: "e2eInviteCode00000000a", expiresAt: Date.UTC(2026, 9, 31) };

export const FINGERPRINT: Fingerprint = { offBeatenPct: 72, strongest: ["videogame", "artist"] };
export const RISING: RisingItem[] = [
  {
    entity: { id: "E2E00000-0000-4000-8000-0000000000R1", name: "Cascadia", domain: "videogame" },
    larryLine: "Cascadia is picking up fans near you this week.",
    plainLine: "Cascadia is rising near you.",
  },
];
export const MATCHDAY: MatchDay[] = [{ team: "Mumbai Indians", league: "IPL", source: "Public schedule (test data)" }];

export interface ContractMocks {
  account?: Account | null;
  profile?: ProfileData;
  podium?: PodiumResponse;
  leave?: LeaveResponse;
}

/**
 * Mocks every new final-build route with the fixed answers above. Sync and friends keep state
 * for the page's lifetime, so a PUT then GET round-trips. Pass `account: null` for signed out.
 */
export async function mockContracts(target: Page | BrowserContext, opts: ContractMocks = {}) {
  let account = opts.account === undefined ? ACCOUNT : opts.account;
  let sync: SyncBlob | null = null;
  let friends = [...FRIENDS];
  const method = (r: Route) => r.request().method();
  const body = <T>(r: Route) => JSON.parse(r.request().postData() ?? "{}") as T;

  await target.route("**/api/account", (r) => {
    if (method(r) === "DELETE") {
      account = null;
      return json(r, { ok: true });
    }
    if (method(r) === "POST") {
      const b = body<{ name?: string; username?: string }>(r);
      account = { ...ACCOUNT, name: b.name ?? ACCOUNT.name, username: b.username ?? ACCOUNT.username, showOnLeaderboards: false, glory: 0, publicTitleCounts: {} };
    }
    if (method(r) === "PATCH" && account) {
      const b = body<{ showOnLeaderboards?: boolean }>(r);
      if (typeof b.showOnLeaderboards === "boolean") account = { ...account, showOnLeaderboards: b.showOnLeaderboards };
    }
    return account ? json(r, account) : json(r, { error: "Sign in to see your account." }, 401);
  });
  await target.route("**/api/account/username", (r) => json(r, { username: "CalmWalrus12" }));
  await target.route("**/api/account/sync", (r) => {
    if (method(r) === "PUT") {
      sync = body<SyncBlob>(r);
      return json(r, { ok: true });
    }
    return json(r, sync ?? { persona: null, steps: [], placeCounters: [] });
  });
  await target.route("**/api/checkins/arrive", (r) => json(r, ARRIVE));
  await target.route("**/api/checkins/leave", (r) => json(r, opts.leave ?? LEAVE));
  await target.route("**/api/podium/**", (r) => {
    if (r.request().url().includes("/api/podium/mine")) return json(r, { ok: true });
    return method(r) === "GET" ? json(r, opts.podium ?? PODIUM) : json(r, { ok: true });
  });
  await target.route("**/api/profile/**", (r) => json(r, opts.profile ?? STRANGER_PROFILE));
  await target.route("**/api/friends", (r) => {
    const m = method(r);
    if (m === "GET") return json(r, { friends });
    if (m === "POST") {
      const b = body<{ action: string }>(r);
      return b.action === "invite" ? json(r, INVITE) : json(r, { friend: FRIENDS[0] });
    }
    if (m === "DELETE") {
      const { uid } = body<{ uid: string }>(r);
      friends = friends.filter((f) => f.uid !== uid);
    }
    return json(r, { ok: true });
  });
  await target.route("**/api/fingerprint", (r) => json(r, FINGERPRINT));
  await target.route("**/api/matchday**", (r) => json(r, MATCHDAY));
}
