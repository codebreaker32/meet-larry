import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRISIS_TEXT } from "@/lib/crisis";

// The remaining /api/rooms route handlers (meet chats only; creating or joining a room by code is retired), with the store in memory and Larry and Qloo mocked.
const mocks = vi.hoisted(() => ({
  runGroupChat: vi.fn(),
  findGroupCommonGround: vi.fn(),
  release: vi.fn(),
  holdBudget: vi.fn(),
}));
vi.mock("@/lib/budget", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  holdBudget: mocks.holdBudget,
}));
vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runGroupChat: mocks.runGroupChat,
}));
vi.mock("@/lib/qloo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findGroupCommonGround: mocks.findGroupCommonGround,
}));

const { resetMemoryStore } = await import("./store");
const svc = await import("./service");
const roomRoute = await import("@/app/api/rooms/[code]/route");
const messagesRoute = await import("@/app/api/rooms/[code]/messages/route");
const leaveRoute = await import("@/app/api/rooms/[code]/leave/route");
const larryRoute = await import("@/app/api/rooms/[code]/larry/route");

let ipCounter = 0;
let ip = "";
const req = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "x-real-ip": ip, ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
const ctx = (code: string) => ({ params: Promise.resolve({ code }) });
const profile = (name: string) => ({ name, items: [{ id: "q1", name: "Spirited Away", domain: "movie" as const }] });

beforeEach(() => {
  ip = `198.51.100.${++ipCounter}`;
  resetMemoryStore();
  mocks.runGroupChat.mockReset();
  mocks.findGroupCommonGround.mockReset();
  mocks.release.mockReset();
  mocks.holdBudget.mockReset();
  mocks.holdBudget.mockResolvedValue({ record: vi.fn(), check: vi.fn(), release: mocks.release });
  mocks.findGroupCommonGround.mockResolvedValue({ shared: [], bridges: [] });
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});
afterEach(() => vi.unstubAllEnvs());

async function create(name = "Sam") {
  return (await svc.createRoom(profile(name))) as unknown as { room: { code: string; version: number }; memberId: string; token: string };
}

describe("/api/rooms", () => {
  it("polls with since", async () => {
    const a = await create();
    const b = JSON.parse(JSON.stringify(await svc.joinRoom(a.room.code, profile("Priya"))));
    expect(b.room.members).toHaveLength(2);
    expect(b.token).toBeTruthy();
    expect(JSON.stringify(b.room)).not.toContain("tokenHashes");

    const poll = await roomRoute.GET(
      req(`/api/rooms/${a.room.code}?since=${b.room.version}`, { headers: { "x-member-id": a.memberId, "x-member-token": a.token } }),
      ctx(a.room.code),
    );
    expect(poll.headers.get("cache-control")).toBe("no-store");
    const polled = await poll.json();
    // Ground may have landed after the join (after() runs it straight away in tests).
    if (!polled.unchanged) expect(polled.room.version).toBeGreaterThan(b.room.version);

    // Without member headers: only a preview for the join screen.
    const outside = await (await roomRoute.GET(req(`/api/rooms/${a.room.code}`), ctx(a.room.code))).json();
    expect(outside).toEqual({ preview: { code: a.room.code, names: ["Sam", "Priya"], openSeats: 3 } });
    expect(outside.room).toBeUndefined();

    // Wrong credentials: 403.
    const wrong = await roomRoute.GET(
      req(`/api/rooms/${a.room.code}`, { headers: { "x-member-id": a.memberId, "x-member-token": "nope" } }),
      ctx(a.room.code),
    );
    expect(wrong.status).toBe(403);
  });

  it("counts reads with wrong credentials as misses", async () => {
    const a = await create();
    const bad = { "x-member-id": a.memberId, "x-member-token": "guess" };
    for (let i = 0; i < 30; i++) await roomRoute.GET(req(`/api/rooms/${a.room.code}`, { headers: bad }), ctx(a.room.code));
    const res = await roomRoute.GET(req(`/api/rooms/${a.room.code}`), ctx(a.room.code));
    expect(res.status).toBe(429);
  });

  it("answers 404 for a bad or unknown code", async () => {
    expect((await roomRoute.GET(req("/api/rooms/nope"), ctx("nope"))).status).toBe(404);
    expect((await roomRoute.GET(req("/api/rooms/ABCDEF"), ctx("ABCDEF"))).status).toBe(404);
  });

  it("stops an IP that keeps trying codes that don't exist, before it can find one", async () => {
    const a = await create();
    for (let i = 0; i < 30; i++) await roomRoute.GET(req("/api/rooms/ABCDEF"), ctx("ABCDEF"));
    const res = await roomRoute.GET(req(`/api/rooms/${a.room.code}`), ctx(a.room.code));
    expect(res.status).toBe(429);
  });

  it("posts messages, answers a crisis line with help, refuses a bad token, and leaves", async () => {
    const a = await create();
    const post = (body: unknown) => messagesRoute.POST(req(`/api/rooms/${a.room.code}/messages`, { body }), ctx(a.room.code));

    const bad = await post({ memberId: a.memberId, token: "wrong", text: "hi", toLarry: false });
    expect(bad.status).toBe(403);

    const ok = await post({ memberId: a.memberId, token: a.token, text: "hi", toLarry: false });
    expect((await ok.json()).room.messages).toHaveLength(1);

    const crisis = await post({ memberId: a.memberId, token: a.token, text: "I want to end it all", toLarry: true });
    expect(crisis.status).toBe(200);
    expect((await crisis.json()).room.messages.at(-1).text).toBe(CRISIS_TEXT);
    expect(mocks.runGroupChat).not.toHaveBeenCalled();

    const invalid = await post({ memberId: a.memberId, token: a.token, text: 5, toLarry: "yes" });
    expect(invalid.status).toBe(400);

    const leave = await leaveRoute.POST(
      req(`/api/rooms/${a.room.code}/leave`, { body: { memberId: a.memberId, token: a.token } }),
      ctx(a.room.code),
    );
    expect(await leave.json()).toEqual({ ok: true });
    expect((await roomRoute.GET(req(`/api/rooms/${a.room.code}`), ctx(a.room.code))).status).toBe(404);
  });

  it("excuses Larry for the whole room: messages are kept but never reach Larry, until hello", async () => {
    const a = await create();
    const joined = await svc.joinRoom(a.room.code, profile("Priya"));
    const larry = (body: unknown) => larryRoute.POST(req(`/api/rooms/${a.room.code}/larry`, { body }), ctx(a.room.code));
    const post = (body: unknown) => messagesRoute.POST(req(`/api/rooms/${a.room.code}/messages`, { body }), ctx(a.room.code));

    expect((await larry({ memberId: a.memberId, token: "wrong", away: true })).status).toBe(403);
    expect((await larry({ memberId: a.memberId, token: a.token, away: "yes" })).status).toBe(400);

    const away = await larry({ memberId: a.memberId, token: a.token, away: true });
    expect(away.status).toBe(200);
    expect(away.headers.get("cache-control")).toBe("no-store");
    expect((await away.json()).room.larryAway).toBe(true);

    // Priya's phone sees it too.
    const seen = await (
      await roomRoute.GET(req(`/api/rooms/${a.room.code}`, { headers: { "x-member-id": joined.memberId, "x-member-token": joined.token } }), ctx(a.room.code))
    ).json();
    expect(seen.room.larryAway).toBe(true);

    const sent = await post({ memberId: joined.memberId, token: joined.token, text: "Larry, are you there?", toLarry: true });
    expect(sent.status).toBe(200);
    expect((await sent.json()).room.messages.at(-1)).toMatchObject({ excused: true, toLarry: false });
    const crisis = await post({ memberId: joined.memberId, token: joined.token, text: "I want to end it all", toLarry: false });
    const crisisBody = await crisis.json();
    expect(crisisBody.crisis).toBe(true);
    expect(crisisBody.room.messages.at(-1)).toMatchObject({ excused: true });
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
    expect(mocks.holdBudget).not.toHaveBeenCalled();

    const back = await (await larry({ memberId: joined.memberId, token: joined.token, away: false })).json();
    expect(back.room.larryAway).toBeUndefined();
    expect(back.room.larryBackAt).toBeGreaterThan(0);
  });

});
