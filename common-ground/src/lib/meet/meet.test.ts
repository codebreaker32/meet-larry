import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Open to meet end to end through the route handlers and the service, with storage in memory.
// Qloo and Larry are mocked: no Qloo or model call can happen here.
const mocks = vi.hoisted(() => ({
  findCommonGround: vi.fn(),
  runGroupChat: vi.fn(),
  holdBudget: vi.fn(),
}));
vi.mock("@/lib/qloo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCommonGround: mocks.findCommonGround,
  findGroupCommonGround: vi.fn().mockResolvedValue({ shared: [], bridges: [] }),
}));
vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runGroupChat: mocks.runGroupChat,
}));
// Accounts: the test's x-test-uid header is the signed-in account (accounts are 18+);
// x-test-signed-out means no account. Visit tokens are "visit:<placeId>" (a verified check-in there).
vi.mock("@/lib/account/session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSession: async (r: Request) =>
    r.headers.get("x-test-signed-out") ? null : { uid: r.headers.get("x-test-uid") ?? "tester", isAdult: true, isDemo: false },
}));
vi.mock("@/lib/checkin-verify", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyVisitToken: (t: string) => (typeof t === "string" && t.startsWith("visit:") ? { placeId: t.slice(6), t: Date.now() } : null),
}));
vi.mock("@/lib/budget", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  holdBudget: mocks.holdBudget,
}));

const { memoryKv, resetMeetMemory } = await import("./kv");
const { resetMemoryStore } = await import("@/lib/rooms/store");
const rooms = await import("@/lib/rooms/service");
const svc = await import("./service");
const { resetSharedQueue, queueBridges } = await import("./shared");
const { listReports } = await import("./reports");
const { MEET_TTL_MS, MEET_IDLE_MS, WAVES_PER_VISIT, PICKS_LOCK_MS, MEET_VENUES_PER_CODE_DAY } = await import("./config");
const { resetRateLimits } = await import("@/lib/rate-limit");
const nearbyRoute = await import("@/app/api/meet/[placeId]/route");
const openRoute = await import("@/app/api/meet/[placeId]/open/route");
const closeRoute = await import("@/app/api/meet/[placeId]/close/route");
const waveRoute = await import("@/app/api/meet/[placeId]/wave/route");
const blockRoute = await import("@/app/api/meet/block/route");
const reportRoute = await import("@/app/api/meet/report/route");
const roomRoute = await import("@/app/api/rooms/[code]/route");

const CAFE = "11111111-AAAA-4AAA-8AAA-111111111111";
const LIBRARY = "22222222-BBBB-4BBB-8BBB-222222222222";
/** Where each venue is (Qloo's coordinates), and so where a phone there says it is. */
const HERE: Record<string, { lat: number; lon: number; accuracy: number }> = {
  [CAFE]: { lat: 51.5, lon: -0.12, accuracy: 20 },
  [LIBRARY]: { lat: 51.52, lon: -0.1, accuracy: 20 },
};

type Item = { id: string; name: string; domain: "movie" | "sports_team" | "artist" };
const item = (id: string, name: string, domain: Item["domain"] = "movie"): Item => ({ id, name, domain });
const GHIBLI = item("e-ghibli", "Spirited Away");
const CRICKET = item("e-cricket", "Mumbai Indians", "sports_team");
const SECRET_PICK = item("e-secret", "Private Pick Nobody Shares", "artist");

const persona = (name: string, likes: Item[]) => ({ name, likes });
const PRIYA = persona("Priya", [GHIBLI, CRICKET, SECRET_PICK, item("p4", "Pick four"), item("p5", "Pick five")]);
const SAM = persona("Sam", [GHIBLI, CRICKET, item("s3", "Sam pick three"), item("s4", "Sam pick four")]);
// Shares only one pick with Priya and Sam: easy to fish for, so not listed without a Qloo bridge.
const ALEX = persona("Alex", [GHIBLI, item("a2", "Alex two"), item("a3", "Alex three"), item("a4", "Alex four")]);
const NOBODY = persona("Nobody", [item("n1", "Unrelated one"), item("n2", "Unrelated two")]);

let ip = "";
let ipCounter = 0;
const req = (path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new Request(`http://localhost${path}`, {
    method: init.body ? "POST" : "GET",
    headers: { "x-real-ip": ip, ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
const at = (placeId: string) => ({ params: Promise.resolve({ placeId }) });
const whereHeader = (w: { lat: number; lon: number; accuracy: number }) => `${w.lat},${w.lon},${w.accuracy}`;

let now = Date.UTC(2026, 9, 30, 12);
const advance = (ms: number) => {
  now += ms;
  vi.setSystemTime(now);
};

async function seedVenue(id: string, name: string) {
  await memoryKv.update(`venue:${id.toLowerCase()}`, () => ({ id, name, ...HERE[id] }), 24 * 60 * 60 * 1000);
}

let openCounter = 0;
async function open(placeId: string, deviceId: string, p: ReturnType<typeof persona>, adult: unknown = true, where: unknown = HERE[placeId]) {
  // Each phone on its own network, so only the "open" rate-limit test hits the per-IP limit.
  const headers = { "x-real-ip": `192.0.2.${++openCounter % 250}.${openCounter}`, "x-test-uid": deviceId };
  const res = await openRoute.POST(
    req(`/api/meet/${placeId}/open`, { body: { deviceId, persona: p, adult, where, visitToken: `visit:${placeId}` }, headers }),
    at(placeId),
  );
  return { res, body: await res.json() };
}

async function nearby(placeId: string, sessionId: string, where: { lat: number; lon: number; accuracy: number } | null = HERE[placeId]) {
  const headers: Record<string, string> = { "x-meet-session": sessionId, ...(where ? { "x-meet-where": whereHeader(where) } : {}) };
  const res = await nearbyRoute.GET(req(`/api/meet/${placeId}`, { headers }), at(placeId));
  return { res, body: await res.json() };
}

async function waveAt(placeId: string, sessionId: string, groupId: string, where: unknown = HERE[placeId]) {
  const res = await waveRoute.POST(req(`/api/meet/${placeId}/wave`, { body: { sessionId, groupId, where } }), at(placeId));
  return { res, body: await res.json() };
}

type Group = { groupId: string; kind: string; thing: string; count: number; line: string; waved: boolean };
const groupsOf = async (placeId: string, sessionId: string) => (await nearby(placeId, sessionId)).body.groups as Group[];

beforeEach(async () => {
  ip = `203.0.113.${++ipCounter}`;
  now = Date.UTC(2026, 9, 30, 12);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-not-used");
  resetMeetMemory();
  resetMemoryStore();
  resetSharedQueue();
  resetRateLimits();
  mocks.findCommonGround.mockReset().mockResolvedValue({ shared: [], bridges: [] });
  mocks.runGroupChat.mockReset();
  mocks.holdBudget.mockReset().mockResolvedValue({ record: vi.fn(), check: vi.fn(), release: vi.fn() });
  await seedVenue(CAFE, "Kettle Café");
  await seedVenue(LIBRARY, "Town Library");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("18+ and switching on", () => {
  it("refuses without an explicit 18+ confirmation", async () => {
    for (const adult of [false, null, "yes", 1, "true"]) {
      const { res, body } = await open(CAFE, "device-priya-1", PRIYA, adult);
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/18\+/);
    }
    // Left out altogether.
    const missing = await openRoute.POST(req(`/api/meet/${CAFE}/open`, { body: { deviceId: "device-priya-1", persona: PRIYA, where: HERE[CAFE], visitToken: `visit:${CAFE}` } }), at(CAFE));
    expect(missing.status).toBe(400);
    expect((await open(CAFE, "device-priya-1", PRIYA, true)).res.status).toBe(200);
  });

  it("needs picks, a real public venue, and an access code", async () => {
    expect((await open(CAFE, "device-x-12345", persona("X", []))).res.status).toBe(400);
    expect((await open("not a place!", "device-x-12345", PRIYA)).res.status).toBe(404);
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "");
    const denied = await open(CAFE, "device-x-12345", PRIYA);
    expect(denied.res.status).toBe(401);
  });

  it("needs proof of presence: a fix at the venue, never stored", async () => {
    const none = await open(CAFE, "device-priya-1", PRIYA, true, null);
    expect(none.res.status).toBe(428);
    expect(none.body.error).toMatch(/needs your location/);
    // At the library, 2.6 km away: a copied card is no use from somewhere else.
    const away = await open(CAFE, "device-priya-1", PRIYA, true, HERE[LIBRARY]);
    expect(away.res.status).toBe(403);
    expect(away.body.error).toBe("You don't seem to be at Kettle Café right now. Open to meet only works while you are there.");
    const fuzzy = await open(CAFE, "device-priya-1", PRIYA, true, { ...HERE[CAFE], accuracy: 2000 });
    expect(fuzzy.res.status).toBe(403);
    expect(fuzzy.body.error).toMatch(/can't tell exactly where you are/);
    // 120 m up the road is still here.
    expect((await open(CAFE, "device-priya-1", PRIYA, true, { lat: 51.50108, lon: -0.12, accuracy: 15 })).res.status).toBe(200);
    // Nothing about where anyone is was kept.
    const stored = JSON.stringify(await memoryKv.get(`venue-open:${CAFE.toLowerCase()}`));
    expect(stored).not.toContain("51.5");
    expect(stored).not.toMatch(/"(lat|lon|accuracy|where)"/);
  });

  it("refuses a venue Qloo has no coordinates for (nobody could show they are there)", async () => {
    const place = { entity_id: "33333333-CCCC-4CCC-8CCC-333333333333", name: "Nowhere Café", types: ["urn:entity:place"], tags: [{ tag_id: "urn:tag:category:place:cafe" }] };
    await expect(
      svc.openMeet(place.entity_id, { deviceId: "device-priya-1", persona: PRIYA, adult: true, where: HERE[CAFE] }, { fetchPlace: async () => place }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rate limits switching on per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await openRoute.POST(
        req(`/api/meet/${CAFE}/open`, { body: { deviceId: `device-burst-${i}0000`, persona: PRIYA, adult: true, where: HERE[CAFE], visitToken: `visit:${CAFE}` } }),
        at(CAFE),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("limits switching on per phone, and venues per access code per day", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await open(CAFE, "device-same-001", PRIYA)).res.status); // a new IP each time
    expect(statuses.slice(0, 4).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    // One code can't sweep a town: only a few different venues a day.
    const venueStatuses: string[] = [];
    for (let i = 0; i < MEET_VENUES_PER_CODE_DAY + 1; i++) {
      const id = `4444444${i}-DDDD-4DDD-8DDD-44444444444${i}`;
      const out = await svc
        .openMeet(id, { deviceId: `device-sweep-${i}000`, persona: PRIYA, adult: true, where: HERE[CAFE], code: "LARRY-TEST-CODE" }, {
          fetchPlace: async () => ({ entity_id: id, name: `Café ${i}`, types: ["urn:entity:place"], tags: [{ tag_id: "urn:tag:category:place:cafe" }], location: { lat: 51.5, lon: -0.12 } }),
        })
        .then(() => "ok")
        .catch((e: { status: number }) => String(e.status));
      venueStatuses.push(out);
    }
    expect(venueStatuses.slice(0, MEET_VENUES_PER_CODE_DAY).every((s) => s === "ok")).toBe(true);
    expect(venueStatuses.at(-1)).toBe("429");
  });

  it("only accepts public places from Qloo's data", async () => {
    const { isMeetableVenue } = await import("./venue");
    const place = (tags: string[], extra: object = {}) => ({ entity_id: "x", name: "X", types: ["urn:entity:place"], tags: tags.map((t) => ({ tag_id: t })), ...extra });
    expect(isMeetableVenue(place(["urn:tag:category:place:cafe"]))).toBe(true);
    expect(isMeetableVenue(place(["urn:tag:category:place:night_club"]))).toBe(false);
    expect(isMeetableVenue(place(["urn:tag:genre:place:hostel"]))).toBe(false);
    expect(isMeetableVenue(place(["urn:tag:category:place:bar"]))).toBe(false);
    expect(isMeetableVenue(place(["urn:tag:category:place:bar", "urn:tag:category:place:board_game_club"]))).toBe(true);
    expect(isMeetableVenue(place(["urn:tag:category:place:cafe"], { properties: { is_closed: true } }))).toBe(false);
    expect(isMeetableVenue({ entity_id: "x", name: "X", types: ["urn:entity:movie"] })).toBe(false);
  });
});

describe("the nearby list", () => {
  it("shows only anonymous counts per shared thing, and leaks nothing else", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    await open(CAFE, "device-nobody-1", NOBODY);
    await open(CAFE, "device-alex-001", ALEX);
    const { res, body } = await nearby(CAFE, priya.sessionId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Nobody shares nothing; Alex shares one pick only (anyone could fish for that). Neither is counted.
    expect(body.groups).toHaveLength(1);
    const [g] = body.groups;
    // Sam is counted under one thing only, never with a list of their picks.
    expect(g).toMatchObject({ kind: "pick", thing: "Spirited Away", count: 1, line: "Someone here likes Spirited Away too.", waved: false });
    expect(Object.keys(g).sort()).toEqual(["count", "groupId", "kind", "line", "thing", "waved", "witty"]);
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "groups", "matches", "venue"]);

    const raw = JSON.stringify(body);
    for (const leak of ["Sam", "Nobody", "Alex", "device-sam", "Sam pick", "Unrelated", "Mumbai Indians", "s_", "a_", "tokenHash", "seenAt", "lat", "lon"]) {
      expect(raw).not.toContain(leak);
    }
    // The only time in the answer is the viewer's own switch-off time.
    expect(body.expiresAt).toBe(now + MEET_TTL_MS);
    expect(raw.match(/\d{13}/g)).toEqual([String(now + MEET_TTL_MS)]);
  });

  it("takes the session from the header only, never the query string (tokens stay out of URLs and logs)", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const headers = { "x-meet-where": whereHeader(HERE[CAFE]) };
    const res = await nearbyRoute.GET(req(`/api/meet/${CAFE}?session=${encodeURIComponent(priya.sessionId)}`, { headers }), at(CAFE));
    const body = await res.json();
    expect(body.groups).toBeUndefined();
    expect(body.matches).toBeUndefined();
  });

  it("counts several people under one thing without saying which is which", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    await open(CAFE, "device-twin-001", persona("Twin", [GHIBLI, CRICKET, item("t3", "Twin three")]));
    const groups = await groupsOf(CAFE, priya.sessionId);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, line: "2 people here like Spirited Away too." });
  });

  it("never names the viewer's own unshared picks to others", async () => {
    await open(CAFE, "device-priya-1", PRIYA);
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    const raw = JSON.stringify((await nearby(CAFE, sam.sessionId)).body);
    expect(raw).not.toContain(SECRET_PICK.name);
    expect(raw).not.toContain("Priya");
  });

  it("adds Qloo bridges found in the background, one pair at a time", async () => {
    mocks.findCommonGround.mockResolvedValue({ shared: [], bridges: [{ name: "Stardew Valley" }] });
    const alex = (await open(CAFE, "device-alex-001", persona("Alex", [item("a1", "Only Alex")]))).body;
    await open(CAFE, "device-nobody-1", NOBODY);
    expect(await groupsOf(CAFE, alex.sessionId)).toHaveLength(0);
    await vi.waitFor(() => expect(mocks.findCommonGround).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await groupsOf(CAFE, alex.sessionId)).toHaveLength(1));
    const g = (await groupsOf(CAFE, alex.sessionId))[0];
    expect(g).toMatchObject({ kind: "bridge", thing: "Stardew Valley", line: "Larry thinks you and someone here would both love Stardew Valley." });
    // Cached for the visit: asking again makes no new Qloo call.
    await nearby(CAFE, alex.sessionId);
    expect(mocks.findCommonGround).toHaveBeenCalledTimes(1);
  });

  it("switches off a phone that has left the venue, and refuses an answer without a fix", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    const noFix = await nearby(CAFE, priya.sessionId, null);
    expect(noFix.res.status).toBe(428);
    expect(noFix.body.groups).toBeUndefined();
    // Still on: a missing fix only refuses that one answer.
    expect((await nearby(CAFE, priya.sessionId)).res.status).toBe(200);
    // Sam walks to the library: off at once, and gone from Priya's list.
    const gone = await nearby(CAFE, sam.sessionId, HERE[LIBRARY]);
    expect(gone.res.status).toBe(410);
    expect(gone.body.error).toBe("You seem to have left Kettle Café, so Open to meet is off now.");
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(0);
    expect((await nearby(CAFE, sam.sessionId)).res.status).toBe(410);
  });
});

describe("anonymity", () => {
  it("gives a different group id for every viewer, venue and visit", async () => {
    const priya1 = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam1 = (await open(CAFE, "device-sam-0001", SAM)).body;
    const seenByPriya = (await groupsOf(CAFE, priya1.sessionId))[0].groupId;
    const seenBySam = (await groupsOf(CAFE, sam1.sessionId))[0].groupId;
    expect(seenBySam).not.toBe(seenByPriya);

    // Same two people at another venue: new ids.
    const priya2 = (await open(LIBRARY, "device-priya-1", PRIYA)).body;
    await open(LIBRARY, "device-sam-0001", SAM);
    const atLibrary = (await groupsOf(LIBRARY, priya2.sessionId)).map((g) => g.groupId);
    expect(atLibrary).toHaveLength(1);
    expect(atLibrary[0]).not.toBe(seenByPriya);

    // A new visit to the first venue: new ids again.
    await svc.closeMeet(priya2.sessionId);
    expect((await open(CAFE, "device-sam-0001", SAM)).res.status).toBe(200);
    const priya3 = (await open(CAFE, "device-priya-1", PRIYA)).body;
    expect((await groupsOf(CAFE, priya3.sessionId))[0].groupId).not.toBe(seenByPriya);
  });

  it("keeps picks fixed for the visit, so nobody can re-open with new picks to read a stranger's card", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    const fishing = await open(CAFE, "device-priya-1", persona("Priya", [item("s3", "Sam pick three"), item("s4", "Sam pick four")]));
    expect(fishing.res.status).toBe(409);
    expect(fishing.body.error).toMatch(/picks are fixed for this visit/);
    // The same picks again is fine (re-opening starts the 3 hours again, with a new token).
    const reopened = await open(CAFE, "device-priya-1", PRIYA);
    expect(reopened.res.status).toBe(200);
    expect((await nearby(CAFE, priya.sessionId)).res.status).toBe(410);
    // Switching off and straight back on with other picks: still refused for a while.
    await svc.closeMeet(reopened.body.sessionId);
    expect((await open(CAFE, "device-priya-1", persona("Priya", [item("s3", "Sam pick three"), GHIBLI]))).res.status).toBe(409);
    advance(PICKS_LOCK_MS + 1000);
    expect((await open(CAFE, "device-priya-1", persona("Priya", [item("s3", "Sam pick three"), GHIBLI]))).res.status).toBe(200);
  });

  it("opening at a new venue closes the old one (you can only be in one place)", async () => {
    await open(CAFE, "device-priya-1", PRIYA);
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    expect(await groupsOf(CAFE, sam.sessionId)).toHaveLength(1);
    await open(LIBRARY, "device-priya-1", PRIYA);
    expect(await groupsOf(CAFE, sam.sessionId)).toHaveLength(0);
  });

  it("a session only works at its own venue", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    expect((await nearby(LIBRARY, priya.sessionId)).res.status).toBe(403);
  });
});

describe("waves", () => {
  async function pair() {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    const samGroup = (await groupsOf(CAFE, priya.sessionId))[0].groupId;
    const priyaGroup = (await groupsOf(CAFE, sam.sessionId))[0].groupId;
    return { priya, sam, samGroup, priyaGroup };
  }

  it("opens a room only when both wave", async () => {
    const { priya, sam, samGroup, priyaGroup } = await pair();
    const first = await waveAt(CAFE, priya.sessionId, samGroup);
    expect(first.body).toEqual({ mutual: false });
    // Sam is not told that Priya waved.
    const samView = (await nearby(CAFE, sam.sessionId)).body;
    expect(samView.groups[0]).toMatchObject({ waved: false });
    expect(samView.matches).toEqual([]);

    const second = await waveAt(CAFE, sam.sessionId, priyaGroup);
    expect(second.body.mutual).toBe(true);
    const code = second.body.roomCode as string;
    expect(second.body.credentials).toMatchObject({ code });

    // Priya's next poll carries her own seat in the chat.
    const priyaView = (await nearby(CAFE, priya.sessionId)).body;
    expect(priyaView.matches).toHaveLength(1);
    expect(priyaView.matches[0].credentials.memberId).not.toBe(second.body.credentials.memberId);

    // The room: both people and Larry's intro with what they share and the public venue.
    const { room } = (await rooms.readRoom(code, { memberId: second.body.credentials.memberId, token: second.body.credentials.token })) as { room: { members: { name: string }[]; messages: { from: string; text: string }[]; meet?: { venueName: string } } };
    expect(room.members.map((m) => m.name).sort()).toEqual(["Priya", "Sam"]);
    expect(room.messages[0].from).toBe("larry");
    expect(room.messages[0].text).toContain("an AI pal");
    expect(room.messages[0].text).toContain("Spirited Away");
    expect(room.messages[0].text).toContain("here at Kettle Café");
    expect(room.meet?.venueName).toBe("Kettle Café");

    // Nobody else can see or join a meet room.
    ip = "203.0.113.250";
    expect((await roomRoute.GET(req(`/api/rooms/${code}`), { params: Promise.resolve({ code }) })).status).toBe(404);
    await expect(rooms.joinRoom(code, { name: "Eve", items: [] })).rejects.toMatchObject({ status: 404 });
  });

  it("a wave needs the phone at the venue too", async () => {
    const { priya, samGroup } = await pair();
    expect((await waveAt(CAFE, priya.sessionId, samGroup, null)).res.status).toBe(428);
    expect((await waveAt(CAFE, priya.sessionId, samGroup, HERE[LIBRARY])).res.status).toBe(410);
  });

  it("allows one wave per person per visit, even after switching off and on", async () => {
    const { priya, samGroup } = await pair();
    expect((await waveAt(CAFE, priya.sessionId, samGroup)).body).toEqual({ mutual: false });
    expect((await waveAt(CAFE, priya.sessionId, samGroup)).body).toEqual({ mutual: false, already: true });
    await svc.closeMeet(priya.sessionId);
    const back = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const again = (await groupsOf(CAFE, back.sessionId))[0];
    expect(again.groupId).not.toBe(samGroup);
    expect((await waveAt(CAFE, back.sessionId, again.groupId)).body).toEqual({ mutual: false, already: true });
  });

  it("caps waves per visit and per IP", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    for (let i = 0; i < WAVES_PER_VISIT + 1; i++) {
      ip = `198.18.0.${i + 1}`;
      await open(CAFE, `device-other-${String(i).padStart(4, "0")}`, persona(`P${i}`, [GHIBLI, CRICKET, item(`o${i}`, `Other ${i}`)]));
    }
    ip = "198.18.1.1";
    const [group] = await groupsOf(CAFE, priya.sessionId);
    expect(group.count).toBe(WAVES_PER_VISIT + 1);
    // One wave at the group reaches the first WAVES_PER_VISIT people, then stops.
    expect((await waveAt(CAFE, priya.sessionId, group.groupId)).res.status).toBe(200);
    expect((await groupsOf(CAFE, priya.sessionId))[0].waved).toBe(false); // one person still not waved at
    ip = "198.18.2.1";
    expect((await waveAt(CAFE, priya.sessionId, group.groupId)).res.status).toBe(429);

    // Per IP: a burst of waves from one network is stopped.
    ip = "198.18.3.1";
    const burst: number[] = [];
    for (let i = 0; i < 7; i++) burst.push((await waveAt(CAFE, priya.sessionId, "g_doesnotexist00")).res.status);
    expect(burst).toContain(429);
  });

  it("can't wave at a group that isn't listed", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-nobody-1", NOBODY);
    expect((await waveAt(CAFE, priya.sessionId, "g_madeupgroupid00")).res.status).toBe(404);
  });
});

describe("block and report", () => {
  it("block hides both ways, at every venue, on a new phone with the same picks, for good", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    const samGroup = (await groupsOf(CAFE, priya.sessionId))[0].groupId;
    const res = await blockRoute.POST(req("/api/meet/block", { body: { sessionId: priya.sessionId, groupId: samGroup } }));
    expect(res.status).toBe(200);
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(0);
    expect(await groupsOf(CAFE, sam.sessionId)).toHaveLength(0);

    // Another venue, Sam on a new phone with nearly the same picks.
    const priya2 = (await open(LIBRARY, "device-priya-1", PRIYA)).body;
    const samNew = (await open(LIBRARY, "device-sam-NEW1", { ...SAM, likes: [...SAM.likes, item("s5", "New pick")] })).body;
    expect(await groupsOf(LIBRARY, priya2.sessionId)).toHaveLength(0);
    expect(await groupsOf(LIBRARY, samNew.sessionId)).toHaveLength(0);

    // Months later.
    advance(90 * 24 * 60 * 60 * 1000);
    await seedVenue(CAFE, "Kettle Café");
    const p3 = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    expect(await groupsOf(CAFE, p3.sessionId)).toHaveLength(0);
  });

  it("blocks survive a module reload, and are never evicted to make room", async () => {
    const blocks = await import("./blocks");
    const a = blocks.identityOf("device-aaaa-01", PRIYA.likes);
    const b = blocks.identityOf("device-bbbb-01", SAM.likes);
    await blocks.addBlock(a, b);
    vi.resetModules();
    const fresh = await import("./blocks");
    expect(await fresh.isBlocked(fresh.identityOf("device-aaaa-01", PRIYA.likes), fresh.identityOf("device-bbbb-01", SAM.likes))).toBe(true);
    const kv = await import("./kv");
    expect(kv.isDurableKey("block:d:x")).toBe(true);
    expect(kv.isDurableKey("report:r_x")).toBe(true);
    expect(kv.isDurableKey("venue-open:x")).toBe(false);
  });

  it("blocking from inside a meet chat removes them, and a normal room refuses them", async () => {
    const { priyaCreds, mutual } = await meetPair();
    const res = await blockRoute.POST(req("/api/meet/block", { body: { room: priyaCreds, targetMemberId: mutual.credentials.memberId } }));
    expect(res.status).toBe(200);
    await expect(rooms.readRoom(mutual.roomCode, { memberId: mutual.credentials.memberId, token: mutual.credentials.token })).rejects.toMatchObject({ status: 403 });
    const left = (await rooms.readRoom(mutual.roomCode, { memberId: priyaCreds.memberId, token: priyaCreds.token })) as { room: { messages: { text: string }[] } };
    expect(left.room.messages.at(-1)?.text).toBe("This chat has ended.");

    // Priya starts a normal room; Sam (same phone) can't get in.
    const created = await rooms.createRoom({ name: "Priya", items: PRIYA.likes }, "device-priya-1");
    await expect(rooms.joinRoom(created.room.code, { name: "Sam", items: SAM.likes }, "device-sam-0001")).rejects.toMatchObject({ status: 404 });
    await expect(rooms.joinRoom(created.room.code, { name: "Alex", items: ALEX.likes }, "device-alex-001")).resolves.toBeTruthy();
  });

  it("block and report still work on someone who already left the meet chat", async () => {
    const { priya, priyaCreds, mutual } = await meetPair();
    await rooms.postMessage(mutual.roomCode, { memberId: mutual.credentials.memberId, token: mutual.credentials.token, text: "send me your address", toLarry: false });
    await rooms.leaveRoom(mutual.roomCode, mutual.credentials.memberId, mutual.credentials.token);
    // The room still offers Block and Report for them.
    const view = (await rooms.readRoom(mutual.roomCode, { memberId: priyaCreds.memberId, token: priyaCreds.token })) as { room: { meet?: { left?: { id: string; name: string }[] } } };
    expect(view.room.meet?.left).toEqual([{ id: mutual.credentials.memberId, name: "Sam" }]);
    const res = await reportRoute.POST(req("/api/meet/report", { body: { room: priyaCreds, targetMemberId: mutual.credentials.memberId, reason: "contact" } }));
    expect(res.status).toBe(200);
    const [r] = await listReports();
    expect(r.messages.some((m) => m.from === "reported" && m.text.includes("address"))).toBe(true);
    // And the block holds: Sam never shows up for Priya again.
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(0);
  });

  it("report keeps the last messages for review and blocks as well", async () => {
    const { priya, priyaCreds, mutual } = await meetPair();
    await rooms.postMessage(mutual.roomCode, { memberId: mutual.credentials.memberId, token: mutual.credentials.token, text: "hey you are a loser", toLarry: false });

    const bad = await reportRoute.POST(req("/api/meet/report", { body: { room: priyaCreds, targetMemberId: mutual.credentials.memberId, reason: "nope" } }));
    expect(bad.status).toBe(400);
    const res = await reportRoute.POST(
      req("/api/meet/report", { body: { room: priyaCreds, targetMemberId: mutual.credentials.memberId, reason: "rude", note: "Mean to me" } }),
    );
    expect(res.status).toBe(200);
    const [r] = await listReports();
    expect(r).toMatchObject({ reason: "rude", note: "Mean to me", where: "meet-chat" });
    expect(r.messages.some((m) => m.from === "reported" && m.text.includes("loser"))).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["at", "id", "messages", "note", "reason", "reported", "reporter", "where"]); // no venue or place id
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(0);
  });

  it("works without an access code and from anywhere (safety always works)", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    const samGroup = (await groupsOf(CAFE, priya.sessionId))[0].groupId;
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "");
    const res = await reportRoute.POST(req("/api/meet/report", { body: { sessionId: priya.sessionId, groupId: samGroup, reason: "unsafe" } }));
    expect(res.status).toBe(200);
    expect((await closeRoute.POST(req(`/api/meet/${CAFE}/close`, { body: { sessionId: priya.sessionId } }))).status).toBe(200);
  });
});

describe("production storage", () => {
  it("refuses Open to meet without durable storage and a fixed secret, but close still works", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LARRY_DB", "memory");
    vi.stubEnv("MEET_SECRET", "");
    const openRes = await open(CAFE, "device-priya-1", PRIYA);
    expect(openRes.res.status).toBe(503);
    expect((await nearby(CAFE, "x".repeat(20))).res.status).toBe(503);
    expect((await closeRoute.POST(req(`/api/meet/${CAFE}/close`, { body: { sessionId: "x".repeat(20) } }))).status).toBe(200);
    const { meetStorageReady } = await import("./http");
    const { meetStoreKind } = await import("./kv");
    // Memory is never durable enough, even with a secret.
    vi.stubEnv("MEET_SECRET", "s".repeat(32));
    expect(meetStorageReady()).toBe(false);
    vi.stubEnv("MEET_SECRET", "");
    // Upstash, or Firestore (the app's database), with a fixed secret.
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    expect(meetStoreKind()).toBe("upstash");
    expect(meetStorageReady()).toBe(false);
    vi.stubEnv("MEET_SECRET", "s".repeat(32));
    expect(meetStorageReady()).toBe(true);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("LARRY_DB", "firestore");
    expect(meetStoreKind()).toBe("firestore");
    expect(meetStorageReady()).toBe(true);
  });
});

describe("Firestore storage", () => {
  it("keeps meet keys under their own prefix, passes the service's own errors through, and wraps storage errors", async () => {
    const { firestoreMeetKv, MeetStoreError } = await import("./kv");
    const seen: string[] = [];
    const base = {
      get: async (k: string) => (seen.push(k), null),
      update: async <T,>(k: string, change: (c: T | null) => T | null | undefined) => (seen.push(k), change(null) ?? null),
      del: async (k: string) => void seen.push(k),
    };
    const kv = firestoreMeetKv(() => base);
    await kv.get("venue-open:x");
    await kv.update("block:y", () => ({ a: 1 }));
    await kv.del("session:z");
    expect(seen).toEqual(["meet:venue-open:x", "meet:block:y", "meet:session:z"]);
    const own = new svc.MeetError(409, "picks fixed");
    await expect(
      kv.update("venue-open:x", () => {
        throw own;
      }),
    ).rejects.toBe(own);
    const down = firestoreMeetKv(() => ({ ...base, get: async () => Promise.reject(new Error("UNAVAILABLE secret detail")) }));
    const err: unknown = await down.get("venue-open:x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeetStoreError);
    expect(String((err as Error).message)).not.toContain("secret detail");
  });
});

describe("accounts and check-ins", () => {
  it("is only for signed-in accounts (18+), with a verified check-in at this venue", async () => {
    const signedOut = await openRoute.POST(
      req(`/api/meet/${CAFE}/open`, {
        body: { deviceId: "device-priya-1", persona: PRIYA, adult: true, where: HERE[CAFE], visitToken: `visit:${CAFE}` },
        headers: { "x-test-signed-out": "1" },
      }),
      at(CAFE),
    );
    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error).toBe("Open to meet is for signed-in members aged 18+. Sign in, and you're in.");
    const noVisit = await openRoute.POST(
      req(`/api/meet/${CAFE}/open`, { body: { deviceId: "device-priya-1", persona: PRIYA, adult: true, where: HERE[CAFE] }, headers: { "x-test-uid": "u1" } }),
      at(CAFE),
    );
    expect(noVisit.status).toBe(403);
    expect((await noVisit.json()).error).toBe("Check in here first, then Open to meet can switch on.");
    const elsewhere = await openRoute.POST(
      req(`/api/meet/${CAFE}/open`, {
        body: { deviceId: "device-priya-1", persona: PRIYA, adult: true, where: HERE[CAFE], visitToken: `visit:${LIBRARY}` },
        headers: { "x-test-uid": "u1" },
      }),
      at(CAFE),
    );
    expect(elsewhere.status).toBe(403);
    // The list and waving need the account too.
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const list = await nearbyRoute.GET(req(`/api/meet/${CAFE}`, { headers: { "x-meet-session": priya.sessionId, "x-test-signed-out": "1" } }), at(CAFE));
    expect(list.status).toBe(401);
  });

  it("follows the account, not the phone: a block holds when they sign in on another phone", async () => {
    const { priya, sam } = await meetPair();
    expect(priya.sessionId && sam.sessionId).toBeTruthy();
    const groups = await groupsOf(CAFE, priya.sessionId);
    expect(groups).toHaveLength(1);
    const blocked = await blockRoute.POST(req("/api/meet/block", { body: { sessionId: priya.sessionId, groupId: groups[0].groupId } }));
    expect(blocked.status).toBe(200);
    // Sam switches off and comes back on a new phone, same account: still hidden from Priya.
    await closeRoute.POST(req(`/api/meet/${CAFE}/close`, { body: { sessionId: sam.sessionId } }));
    const headers = { "x-real-ip": "192.0.2.9", "x-test-uid": "device-sam-0001" };
    const again = await openRoute.POST(
      req(`/api/meet/${CAFE}/open`, { body: { deviceId: "a-brand-new-phone", persona: SAM, adult: true, where: HERE[CAFE], visitToken: `visit:${CAFE}` }, headers }),
      at(CAFE),
    );
    expect(again.status).toBe(200);
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(0);
  });

  it("gives each shared thing Larry's line, grounded in that thing only", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await open(CAFE, "device-sam-0001", SAM);
    const [g] = (await nearby(CAFE, priya.sessionId)).body.groups as (Group & { witty: { line: string; plain: string } })[];
    expect(g.witty.line).toContain("Spirited Away");
    expect(g.witty.plain).toContain("Spirited Away");
    expect(g.witty.line).not.toMatch(/Sam|Kettle|Mumbai/);
  });
});

async function meetPair() {
  const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
  const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
  await waveAt(CAFE, priya.sessionId, (await groupsOf(CAFE, priya.sessionId))[0].groupId);
  const mutual = (await waveAt(CAFE, sam.sessionId, (await groupsOf(CAFE, sam.sessionId))[0].groupId)).body;
  const priyaCreds = (await nearby(CAFE, priya.sessionId)).body.matches[0].credentials as { code: string; memberId: string; token: string };
  return { priya, sam, priyaCreds, mutual: mutual as { roomCode: string; credentials: { memberId: string; token: string } } };
}

describe("expiry", () => {
  it("switches off after 3 hours, and re-opening starts the 3 hours again", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    for (let i = 0; i < 18; i++) {
      advance(MEET_IDLE_MS - 1000);
      await nearby(CAFE, sam.sessionId); // Sam's phone keeps checking in
      if (i % 2 === 0) await nearby(CAFE, priya.sessionId);
    }
    advance(MEET_TTL_MS - 18 * (MEET_IDLE_MS - 1000));
    // 3 hours have passed: both are off.
    expect((await nearby(CAFE, priya.sessionId)).res.status).toBe(410);
    expect((await nearby(CAFE, sam.sessionId)).res.status).toBe(410);
    const again = await open(CAFE, "device-priya-1", PRIYA);
    expect(again.body.expiresAt).toBe(now + MEET_TTL_MS);
  });

  it("hides a phone that stopped checking in, and close hides at once", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    const sam = (await open(CAFE, "device-sam-0001", SAM)).body;
    expect(await groupsOf(CAFE, priya.sessionId)).toHaveLength(1);
    advance(MEET_IDLE_MS + 1000);
    // Priya polls; Sam's phone has been silent for more than 10 minutes.
    await svc.listNearby(CAFE, priya.sessionId, HERE[CAFE]).catch(() => null);
    expect((await nearby(CAFE, sam.sessionId)).res.status).toBe(410);

    const s2 = (await open(CAFE, "device-sam-0001", SAM)).body;
    const p2 = (await open(CAFE, "device-priya-1", PRIYA)).body;
    expect(await groupsOf(CAFE, p2.sessionId)).toHaveLength(1);
    expect((await closeRoute.POST(req(`/api/meet/${CAFE}/close`, { body: { sessionId: s2.sessionId } }))).status).toBe(200);
    expect(await groupsOf(CAFE, p2.sessionId)).toHaveLength(0);
    expect((await nearby(CAFE, s2.sessionId)).res.status).toBe(410);
  });

  it("keeps no trace of a venue once everyone has gone, the wave window passed and the picks lock ran out", async () => {
    const priya = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await svc.closeMeet(priya.sessionId);
    advance(PICKS_LOCK_MS + 1000);
    // The next write prunes the lapsed lock; nobody is left, so the document goes.
    const p2 = (await open(CAFE, "device-priya-1", PRIYA)).body;
    await svc.closeMeet(p2.sessionId);
    advance(PICKS_LOCK_MS + 1000);
    await open(LIBRARY, "device-priya-1", PRIYA);
    const doc = (await memoryKv.get(`venue-open:${CAFE.toLowerCase()}`)) as { sessions: object; locks: object } | null;
    expect(doc === null || (Object.keys(doc.sessions).length === 0 && Object.keys(doc.locks).length <= 1)).toBe(true);
  });
});

describe("a meet chat", () => {
  async function meetRoom() {
    const { mutual } = await meetPair();
    return { code: mutual.roomCode, sam: mutual.credentials };
  }

  it("Larry steps in on red flags without a model call, once per kind for a while", async () => {
    const { code, sam } = await meetRoom();
    const post = (text: string, toLarry = false) => rooms.postMessage(code, { memberId: sam.memberId, token: sam.token, text, toLarry });
    let out = await post("where do you live?", true);
    expect(mocks.runGroupChat).not.toHaveBeenCalled(); // the step-in was Larry's whole answer
    expect(out.room.messages.at(-1)).toMatchObject({ from: "larry" });
    expect(out.room.messages.at(-1)?.text).toContain("here at Kettle Café");
    out = await post("what's your address then");
    expect(out.room.messages.at(-1)?.from).not.toBe("larry"); // cooldown: no second step-in for the same kind
    out = await post("how old are you btw");
    expect(out.room.messages.at(-1)?.text).toContain("18 or over");
    out = await post("come back to my place after");
    expect(out.room.messages.at(-1)?.text).toContain("Let's keep it public");
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
  });

  it("keeps Larry in the room and only suggests the same venue", async () => {
    const { code, sam } = await meetRoom();
    await expect(rooms.setLarryAway(code, sam.memberId, sam.token, true)).rejects.toMatchObject({ status: 400 });
    mocks.runGroupChat.mockResolvedValue({
      messages: [{ from: "larry", text: "You could both try the board games." }],
      quiet: false,
      steps: [
        { kind: "go", text: "Go to Pixel Arcade across town" },
        { kind: "go", text: "Play a game at Kettle Café" },
        { kind: "say", text: "Ask about their favourite film" },
      ],
      profileUpdates: [],
      places: [{ id: "x", name: "Pixel Arcade", tags: [], affinity: 1 }],
    });
    const out = await rooms.postMessage(code, { memberId: sam.memberId, token: sam.token, text: "Larry, any ideas?", toLarry: true, location: { lat: 51.5, lon: -0.1 } });
    expect(mocks.runGroupChat.mock.calls[0][0].location).toBeUndefined();
    expect(out.room.steps.map((s) => s.text)).toEqual(["Play a game at Kettle Café", "Ask about their favourite film"]);
    expect(out.room.places).toBeUndefined();
  });

  it("never sends the asker's persona (notes, routines) to Larry in a meet chat", async () => {
    const { code, sam } = await meetRoom();
    mocks.runGroupChat.mockResolvedValue({ messages: [{ from: "larry", text: "Hi both." }], quiet: false, steps: [], profileUpdates: [], personaUpdates: {} });
    const persona = { version: 1 as const, name: "Sam", likes: SAM.likes, dislikes: [], notes: ["goes to Title Waves on Saturdays"], updatedAt: now };
    const out = await rooms.postMessage(code, { memberId: sam.memberId, token: sam.token, text: "Larry, hello", toLarry: true, persona });
    expect(mocks.runGroupChat.mock.calls[0][0].personas).toBeUndefined();
    expect(JSON.stringify(mocks.runGroupChat.mock.calls[0][0])).not.toContain("Title Waves");
    expect(out.personaUpdate).toBeUndefined();
  });

  it("queues no Qloo work when a pair is already cached", async () => {
    // Sanity check of the background queue's cache: a second call for the same pair is a no-op.
    const a = { fp: "p_a", likes: [GHIBLI] };
    const b = { fp: "p_b", likes: [GHIBLI] };
    await queueBridges(a, b);
    await queueBridges(a, b);
    expect(mocks.findCommonGround).toHaveBeenCalledTimes(1);
  });
});
