import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryRepo } from "@/lib/db/memory";
import { resetRateLimits } from "@/lib/rate-limit";
import { DELETE, GET, PATCH, POST } from "./route";
import { GET as SYNC_GET, PUT as SYNC_PUT } from "./sync/route";
import { GET as USERNAME } from "./username/route";

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({ verifyIdToken: vi.fn(async () => Promise.reject(new Error("no"))), deleteUser: vi.fn() }),
  hasApplicationDefaultCredentials: () => false,
}));

let ip = 0;
const call = (method: string, uid: string | null, body?: unknown, path = "/api/account") =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-real-ip": `10.1.0.${++ip % 250}`,
      ...(uid ? { authorization: `Bearer e2e:${uid}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.stubEnv("E2E", "1");
  vi.stubEnv("LARRY_DB", "memory");
  resetMemoryRepo();
  resetRateLimits();
});

async function freshName(): Promise<string> {
  return ((await (await USERNAME(call("GET", null, undefined, "/api/account/username"))).json()) as { username: string }).username;
}

describe("/api/account", () => {
  it("walks sign-up: signed out, then needs sign-up, then an account without the date of birth", async () => {
    expect((await GET(call("GET", null))).status).toBe(401);
    expect((await GET(call("GET", "u1"))).status).toBe(404);
    const username = await freshName();
    const made = await POST(call("POST", "u1", { name: "Sam", username, dob: { d: 2, m: 3, y: 1994 } }));
    expect(made.status).toBe(201);
    const account = await made.json();
    expect(account).toMatchObject({ uid: "u1", username, budgetCentsLeft: 25, showOnLeaderboards: false });
    expect(JSON.stringify(account)).not.toMatch(/dob|1994/);
    expect((await GET(call("GET", "u1"))).status).toBe(200);
  });

  it("rejects real-name usernames and under-18s", async () => {
    expect((await POST(call("POST", "u1", { name: "Sam", username: "Priya Sharma", dob: { d: 2, m: 3, y: 1994 } }))).status).toBe(400);
    const kid = await POST(call("POST", "u2", { name: "Kid", username: await freshName(), dob: { d: 1, m: 1, y: new Date().getFullYear() - 15 } }));
    expect(kid.status).toBe(403);
    expect(await kid.json()).toMatchObject({ reason: "under-18" });
    expect((await GET(call("GET", "u2"))).status).toBe(404);
  });

  it("PATCH switches 'Show me on place leaderboards' (D12) and refuses anything else", async () => {
    await POST(call("POST", "u1", { name: "Sam", username: await freshName(), dob: { d: 2, m: 3, y: 1994 } }));
    const on = await PATCH(call("PATCH", "u1", { showOnLeaderboards: true }));
    expect(await on.json()).toMatchObject({ showOnLeaderboards: true });
    expect((await PATCH(call("PATCH", "u1", { budgetCentsLeft: 999 }))).status).toBe(400);
    expect((await PATCH(call("PATCH", "u1", {}))).status).toBe(400);
    expect((await PATCH(call("PATCH", null, { showOnLeaderboards: true }))).status).toBe(401);
  });

  it("sync keeps counts only, and DELETE removes the account", async () => {
    await POST(call("POST", "u1", { name: "Sam", username: await freshName(), dob: { d: 2, m: 3, y: 1994 } }));
    const blob = {
      persona: null,
      steps: [{ id: "s1", kind: "go", text: "Go", createdAt: 1, done: true, doneAt: 123 }],
      placeCounters: [{ placeId: "p1", placeName: "Cafe", visits: 2, stage: "rookie", spotWeeks: 1, weeksBits: "11", lastIsoWeek: "2026-W44" }],
    };
    expect((await SYNC_PUT(call("PUT", "u1", blob, "/api/account/sync"))).status).toBe(200);
    const back = await (await SYNC_GET(call("GET", "u1", undefined, "/api/account/sync"))).json();
    expect(JSON.stringify(back)).not.toMatch(/weeksBits|lastIsoWeek|doneAt/);
    expect(back.placeCounters[0]).toEqual({ placeId: "p1", placeName: "Cafe", visits: 2, stage: "rookie", spotWeeks: 1 });
    expect((await DELETE(call("DELETE", "u1"))).status).toBe(200);
    expect((await GET(call("GET", "u1"))).status).toBe(404);
    expect((await SYNC_GET(call("GET", "u1", undefined, "/api/account/sync"))).status).toBe(401);
  });
});
