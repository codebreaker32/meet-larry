import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupChatResult, GroupGround } from "@/lib/contracts";
import { CRISIS_TEXT } from "@/lib/crisis";
import type { Profile } from "@/lib/types";

// Store in memory; Larry (runGroupChat) and Qloo (findGroupCommonGround) are mocked, so no
// model or Qloo call can happen here.
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

const { CODE_ALPHABET, displayCode, parseRoomCode, hashToken, tokenMatches } = await import("./codes");
const { ROOM_TTL_MS, memoryStore, resetMemoryStore } = await import("./store");
const svc = await import("./service");

const profile = (name: string, ids: string[] = []): Profile => ({
  name,
  items: ids.map((id) => ({ id, name: `Pick ${id}`, domain: "movie" as const })),
});

const larryReply = (text: string, extra: Partial<GroupChatResult> = {}): GroupChatResult => ({
  messages: [{ from: "larry", text }],
  quiet: false,
  steps: [],
  profileUpdates: [],
  ...extra,
});

const GROUND: GroupGround = {
  shared: [{ item: { id: "q1", name: "Spirited Away", domain: "movie" }, memberIds: [] }],
  bridges: [],
};

let now = Date.UTC(2026, 9, 30, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  now = Date.UTC(2026, 9, 30, 12);
  vi.setSystemTime(now);
  resetMemoryStore();
  mocks.runGroupChat.mockReset();
  mocks.findGroupCommonGround.mockReset();
  mocks.release.mockReset();
  mocks.holdBudget.mockReset();
  mocks.holdBudget.mockResolvedValue({ record: vi.fn(), check: vi.fn(), release: mocks.release });
  mocks.findGroupCommonGround.mockResolvedValue(GROUND);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const later = (ms: number) => vi.setSystemTime((now += ms));

/** The room as members see it, read straight from the store (404 when it's gone). */
async function peek(code: string) {
  const r = await memoryStore.get(code);
  if (!r) throw svc.notFound();
  return { room: svc.toPublic(r) };
}

async function twoPeople() {
  const a = await svc.createRoom(profile("Sam", ["q1", "q2"]));
  const b = await svc.joinRoom(a.room.code, profile("Priya", ["q1"]));
  return { a, b, code: a.room.code };
}

describe("codes", () => {
  it("are 6 unambiguous characters, shown as LARRY-XXXXXX", async () => {
    const { room } = await svc.createRoom(profile("Sam"));
    expect(room.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(displayCode(room.code)).toBe(`LARRY-${room.code}`);
  });

  it("parse what people type", () => {
    expect(parseRoomCode("larry-k7qm3x")).toBe("K7QM3X");
    expect(parseRoomCode(" LARRY K7QM 3X ")).toBe("K7QM3X");
    expect(parseRoomCode("k7qm3x")).toBe("K7QM3X");
    expect(parseRoomCode("K7QM30")).toBeNull(); // 0 is not in the alphabet
    expect(parseRoomCode("K7QM3")).toBeNull();
    expect(parseRoomCode("../etc")).toBeNull();
  });

  it("store only a hash of the join token", async () => {
    const { room, memberId, token } = await svc.createRoom(profile("Sam"));
    const stored = await memoryStore.get(room.code);
    expect(stored!.tokenHashes[memberId]).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(tokenMatches(token, stored!.tokenHashes[memberId])).toBe(true);
    expect(tokenMatches(token + "x", stored!.tokenHashes[memberId])).toBe(false);
  });
});

describe("create and join", () => {
  it("creates a room with its creator as the first member, and no secrets in the response", async () => {
    const { room, memberId, token } = await svc.createRoom(profile("Sam", ["q1"]));
    expect(room.members).toHaveLength(1);
    expect(room.members[0]).toMatchObject({ id: memberId, name: "Sam", color: "var(--seat-1)" });
    expect(room.version).toBe(1);
    expect(room.larryBusy).toBe(false);
    expect(token.length).toBeGreaterThan(30);
    expect(Object.keys(room).sort()).toEqual(["code", "createdAt", "larryBusy", "members", "messages", "steps", "version"]);
  });

  it("joins, gives each person their own seat colour, and tells two Sams apart", async () => {
    const a = await svc.createRoom(profile("Sam"));
    const b = await svc.joinRoom(a.room.code, profile("sam"));
    expect(b.room.version).toBe(2);
    expect(b.room.members.map((m) => m.name)).toEqual(["Sam", "sam 2"]);
    expect(new Set(b.room.members.map((m) => m.color)).size).toBe(2);
    expect(b.memberId).not.toBe(a.memberId);
  });

  it("404s for a room that doesn't exist", async () => {
    await expect(svc.joinRoom("ABCDEF", profile("Sam"))).rejects.toMatchObject({ status: 404 });
    await expect(peek("ABCDEF")).rejects.toMatchObject({ status: 404 });
  });

  it("computes group common ground once two people are in, and again when members change", async () => {
    const { a, b, code } = await twoPeople();
    await svc.refreshGround(code);
    expect(mocks.findGroupCommonGround).toHaveBeenCalledTimes(1);
    expect(mocks.findGroupCommonGround.mock.calls[0][0]).toHaveLength(2);
    const r = await peek(code);
    expect("room" in r && r.room.ground).toEqual(GROUND);

    // Nothing changed: no second Qloo round.
    await svc.refreshGround(code);
    expect(mocks.findGroupCommonGround).toHaveBeenCalledTimes(1);

    const c = await svc.joinRoom(code, profile("Ana", ["q2"]));
    await svc.refreshGround(code);
    expect(mocks.findGroupCommonGround).toHaveBeenCalledTimes(2);
    expect(mocks.findGroupCommonGround.mock.calls[1][0]).toHaveLength(3);

    // Ana leaves: back to two, so it is worked out again.
    await svc.leaveRoom(code, c.memberId, c.token);
    await svc.refreshGround(code);
    expect(mocks.findGroupCommonGround).toHaveBeenCalledTimes(3);

    // Down to one person: the ground goes, with no Qloo call.
    const priya = (await memoryStore.get(code))!.members.find((m) => m.name === "Priya")!;
    const priyaToken = b.token;
    await svc.leaveRoom(code, priya.id, priyaToken);
    await svc.refreshGround(code);
    expect(mocks.findGroupCommonGround).toHaveBeenCalledTimes(3);
    const left = await peek(code);
    expect("room" in left && left.room.ground).toBeUndefined();
    expect("room" in left && left.room.members.map((m) => m.id)).toEqual([a.memberId]);
  });

  it("keeps the room usable when Qloo fails", async () => {
    mocks.findGroupCommonGround.mockRejectedValueOnce(new Error("Qloo is busy"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { code } = await twoPeople();
    await expect(svc.refreshGround(code)).resolves.toBeUndefined();
    const r = await peek(code);
    expect("room" in r && r.room.ground).toBeFalsy();
    errors.mockRestore();
  });

  it("tries a failed common ground again from polling, with backoff", async () => {
    mocks.findGroupCommonGround.mockRejectedValueOnce(new Error("Qloo is busy"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { a, code } = await twoPeople();
    await svc.refreshGround(code);
    const asSam = { memberId: a.memberId, token: a.token };
    const onGroundStale = vi.fn();
    // Straight after the failure: not yet.
    await svc.readRoom(code, { ...asSam, onGroundStale });
    expect(onGroundStale).not.toHaveBeenCalled();
    later(svc.GROUND_RETRY_MS + 100);
    await svc.readRoom(code, { ...asSam, onGroundStale });
    expect(onGroundStale).toHaveBeenCalledOnce();
    // The retry works; after that, polling asks for nothing more.
    await svc.refreshGround(code);
    expect((await peek(code)).room.ground).toEqual(GROUND);
    later(120_000);
    await svc.readRoom(code, { ...asSam, onGroundStale });
    expect(onGroundStale).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});

describe("people outside the room", () => {
  it("see only names and open seats, never the chat, cards or places", async () => {
    const { a, code } = await twoPeople();
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "secret plans", toLarry: false });
    const out = await svc.readRoom(code);
    expect(out).toEqual({ preview: { code, names: ["Sam", "Priya"], openSeats: 3 } });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("count the seats of phones that went away as open", async () => {
    const a = await svc.createRoom(profile("A"));
    const others = [];
    for (const n of ["B", "C", "D", "E"]) others.push(await svc.joinRoom(a.room.code, profile(n)));
    expect(await svc.readRoom(a.room.code)).toMatchObject({ preview: { openSeats: 0 } });
    later(svc.GHOST_MS + 1000);
    for (const o of others.slice(1)) await svc.readRoom(a.room.code, { memberId: o.memberId, token: o.token });
    expect(await svc.readRoom(a.room.code)).toMatchObject({ preview: { openSeats: 2 } });
  });
});

describe("full room", () => {
  it("lets 5 people in and turns the 6th away with 409", async () => {
    const a = await svc.createRoom(profile("A"));
    for (const n of ["B", "C", "D", "E"]) await svc.joinRoom(a.room.code, profile(n));
    await expect(svc.joinRoom(a.room.code, profile("F"))).rejects.toMatchObject({ status: 409 });
    const r = await peek(a.room.code);
    expect("room" in r && r.room.members).toHaveLength(5);
  });

  it("frees the seat of a phone that went away without leaving", async () => {
    const a = await svc.createRoom(profile("A"));
    const others = [];
    for (const n of ["B", "C", "D", "E"]) others.push(await svc.joinRoom(a.room.code, profile(n)));
    later(svc.GHOST_MS + 1000);
    // Everyone but A is still polling.
    for (const o of others) await svc.readRoom(a.room.code, { memberId: o.memberId, token: o.token });
    const f = await svc.joinRoom(a.room.code, profile("F"));
    expect(f.room.members.map((m) => m.name)).toEqual(["B", "C", "D", "E", "F"]);
    // A's token no longer works.
    await expect(
      svc.postMessage(a.room.code, { memberId: a.memberId, token: a.token, text: "hi", toLarry: false }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("bad credentials", () => {
  it("refuse a wrong token, another member's token, or a made-up member", async () => {
    const { a, b, code } = await twoPeople();
    const post = (memberId: string, token: string) => svc.postMessage(code, { memberId, token, text: "hi", toLarry: false });
    await expect(post(a.memberId, "nope")).rejects.toMatchObject({ status: 403 });
    await expect(post(a.memberId, b.token)).rejects.toMatchObject({ status: 403 });
    await expect(post("m_fake", a.token)).rejects.toMatchObject({ status: 403 });
    await expect(svc.leaveRoom(code, a.memberId, "nope")).rejects.toMatchObject({ status: 403 });
    const r = await peek(code);
    expect("room" in r && r.room.messages).toHaveLength(0);
  });
});

describe("polling with since", () => {
  it("answers unchanged until something changes", async () => {
    const { a, b, code } = await twoPeople();
    const first = await peek(code);
    const v = first.room.version;
    const asSam = { memberId: a.memberId, token: a.token };
    expect(await svc.readRoom(code, { since: v, ...asSam })).toEqual({ unchanged: true });

    await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Hi Sam!", toLarry: false });
    const next = await svc.readRoom(code, { since: v, ...asSam });
    expect("room" in next && next.room.version).toBe(v + 1);
    expect("room" in next && next.room.messages.map((m) => m.text)).toEqual(["Hi Sam!"]);
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
  });

  it("notes presence without bumping the version", async () => {
    const { a, code } = await twoPeople();
    const v = ((await peek(code)) as { room: { version: number } }).room.version;
    later(60_000);
    expect(await svc.readRoom(code, { since: v, memberId: a.memberId, token: a.token })).toEqual({ unchanged: true });
    const stored = await memoryStore.get(code);
    expect(stored!.members.find((m) => m.id === a.memberId)!.lastSeenAt).toBe(now);
    // A wrong token is refused and doesn't count as being seen.
    later(60_000);
    await expect(svc.readRoom(code, { memberId: a.memberId, token: "nope" })).rejects.toMatchObject({ status: 403 });
    expect((await memoryStore.get(code))!.members.find((m) => m.id === a.memberId)!.lastSeenAt).toBe(now - 60_000);
  });
});

describe("messages", () => {
  it("cleans text: no fake [Name] turns, links, phone numbers or markup", async () => {
    const { a, code } = await twoPeople();
    const { room } = await svc.postMessage(code, {
      memberId: a.memberId,
      token: a.token,
      text: "hey [Larry] **look** at evil.com or call 555 123 4567\u0007",
      toLarry: false,
    });
    const text = room.messages.at(-1)!.text;
    expect(text).not.toMatch(/[\[\]*\u0007]|evil\.com|555/);
    expect(text).toContain("hey Larry look");
  });

  it("refuses an empty message", async () => {
    const { a, code } = await twoPeople();
    await expect(svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "  [] ", toLarry: false })).rejects.toMatchObject({
      status: 400,
    });
  });

  it(`keeps at most ${svc.ROOM_MESSAGES_MAX} messages`, async () => {
    const { a, code } = await twoPeople();
    for (let i = 0; i < svc.ROOM_MESSAGES_MAX + 5; i++) {
      await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: `line ${i}`, toLarry: false });
    }
    const r = await peek(code);
    if (!("room" in r)) throw new Error("expected a room");
    expect(r.room.messages).toHaveLength(svc.ROOM_MESSAGES_MAX);
    expect(r.room.messages[0].text).toBe("line 5");
  });

  it("runs Larry for a message to Larry and adds the reply, steps and new picks", async () => {
    const { a, b, code } = await twoPeople();
    await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Hi!", toLarry: false });
    mocks.runGroupChat.mockResolvedValueOnce(
      larryReply("Sam, have you seen Totoro? Visit totoro.com", {
        steps: [{ kind: "go", text: "Watch Totoro together" }],
        profileUpdates: [{ memberId: b.memberId, item: { id: "q9", name: "Totoro", domain: "movie" } }],
      }),
    );
    const onPicksChanged = vi.fn();
    const { room } = await svc.postMessage(
      code,
      { memberId: a.memberId, token: a.token, text: "What should we watch?", toLarry: true, location: { lat: 51.5, lon: -0.1 } },
      { onPicksChanged },
    );
    const input = mocks.runGroupChat.mock.calls[0][0];
    expect(input).toMatchObject({ mode: "group", location: { lat: 51.5, lon: -0.1 } });
    expect(input.members.map((m: { name: string }) => m.name)).toEqual(["Sam", "Priya"]);
    expect(input.history).toEqual([
      { role: "user", content: "[Priya] Hi!" },
      { role: "user", content: "[Sam] What should we watch?" },
    ]);
    expect(room.messages.at(-1)).toMatchObject({ from: "larry", toLarry: false, text: "Sam, have you seen Totoro?" });
    expect(room.steps).toEqual([{ kind: "go", text: "Watch Totoro together" }]);
    expect(room.members.find((m) => m.id === b.memberId)!.profile.items.map((i) => i.id)).toContain("q9");
    expect(room.larryBusy).toBe(false);
    expect(onPicksChanged).toHaveBeenCalledOnce();
  });

  it("keeps the places Larry found so every phone can show venue cards", async () => {
    const { a, code } = await twoPeople();
    const place = { id: "p1", name: "Dice Cafe", distanceKm: 0.4, tags: ["Board game cafe"], affinity: 0.9, reason: "Usually quiet." };
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Dice Cafe is close. Want to go?", { places: [place] }));
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Where can we go?", toLarry: true });
    // Never the distance: it is measured from the asker's exact location.
    const { distanceKm: _km, ...shown } = place;
    void _km;
    expect(room.places).toEqual([shown]);
    // A later reply without places keeps the last ones.
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Sure."));
    const next = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Ok", toLarry: true });
    expect(next.room.places).toEqual([shown]);
  });

  it("sends the asker's persona to Larry and gives only the asker what Larry learned", async () => {
    const { a, b, code } = await twoPeople();
    const persona = { version: 1 as const, name: "Sam", likes: [], dislikes: [], notes: [], updatedAt: 1 };
    const learned = { addLikes: [], addDislikes: [{ name: "Horror" }], addNotes: ["likes calm places"] };
    mocks.runGroupChat.mockResolvedValueOnce(
      larryReply("Noted.", { personaUpdates: { [a.memberId]: learned, [b.memberId]: { ...learned, addNotes: ["not mine"] } } }),
    );
    const out = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "No horror please", toLarry: true, persona });
    const input = mocks.runGroupChat.mock.calls[0][0];
    expect(input.personas).toEqual({ [a.memberId]: persona });
    expect(out.personaUpdate).toEqual(learned);
    // Without a persona, nothing is returned about anyone.
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Ok.", { personaUpdates: { [b.memberId]: learned } }));
    const next = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Hi", toLarry: true });
    expect(next.personaUpdate).toBeUndefined();
  });

  it("keeps Larry's Plan Ticket on the room, and charges nested model calls through authorize", async () => {
    const { a, code } = await twoPeople();
    const place = { id: "p1", name: "Dice Cafe", tags: ["Board games"], affinity: 0.9, fits: [], vibe: "calm" as const };
    const ticket = { place, when: "Sat 11am", opener: "Have you played Wingspan?" };
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Here's a plan.", { planTicket: ticket }));
    const charge = vi.fn();
    const wrap = vi.fn((h) => h);
    const { room } = await svc.postMessage(
      code,
      { memberId: a.memberId, token: a.token, text: "Plan something", toLarry: true },
      { authorize: async () => ({ wrap, charge }) },
    );
    expect(room.planTicket).toEqual(ticket);
    expect(wrap).toHaveBeenCalledOnce();
    expect(mocks.runGroupChat.mock.calls[0][2]).toMatchObject({ charge });
  });

  it("tells Larry it is an Open to meet chat at the venue, and keeps places and tickets out of it", async () => {
    const made = await svc.createMeetRoom(
      { profile: profile("Sam", ["q1"]), device: "d".repeat(64) },
      { profile: profile("Priya", ["q1"]), device: "e".repeat(64) },
      { venueName: "Dice Cafe", shared: ["Spirited Away"] },
    );
    const seat = made.seats[0];
    const place = { id: "p9", name: "Somewhere Else", tags: [], affinity: 0.5, fits: [] };
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("You both like Spirited Away.", { places: [place], planTicket: { place, when: "Sat 11am", opener: "Hi" } }));
    const { room } = await svc.postMessage(made.room.code, { memberId: seat.memberId, token: seat.token, text: "Hi Larry", toLarry: true });
    expect(mocks.runGroupChat.mock.calls[0][0]).toMatchObject({ meet: { venueName: "Dice Cafe" } });
    expect(mocks.runGroupChat.mock.calls[0][0].location).toBeUndefined();
    expect(room.places).toBeUndefined();
    expect(room.planTicket).toBeUndefined();
  });

  it("refreshes the room's ground with Qloo only by default (no uncharged model call)", async () => {
    const { code } = await twoPeople();
    mocks.findGroupCommonGround.mockClear();
    await svc.refreshGround(code);
    for (const call of mocks.findGroupCommonGround.mock.calls) expect(call[2]).toEqual({ curate: false });
  });

  it("holds the AI budget for the run, and releases it", async () => {
    const { a, code } = await twoPeople();
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Hi."));
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(mocks.holdBudget).toHaveBeenCalledOnce();
    expect(mocks.runGroupChat.mock.calls[0][2]).toMatchObject({ budget: { release: mocks.release } });
    expect(mocks.release).toHaveBeenCalled();
  });

  it("doesn't post a question for Larry when the AI budget is used up", async () => {
    const { BudgetExceededError } = await import("@/lib/budget");
    mocks.holdBudget.mockRejectedValueOnce(new BudgetExceededError());
    const { a, code } = await twoPeople();
    await expect(svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    const r = await peek(code);
    expect("room" in r && r.room.messages).toHaveLength(0);
    expect("room" in r && r.room.larryBusy).toBe(false);
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
  });

  it("names people who left in Larry's history", async () => {
    const { a, b, code } = await twoPeople();
    await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Bye!", toLarry: false });
    await svc.leaveRoom(code, b.memberId, b.token);
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Ok."));
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(mocks.runGroupChat.mock.calls[0][0].history[0]).toEqual({ role: "user", content: "[Priya] Bye!" });
  });

  it("asks for setup instead of posting when there is no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { a, code } = await twoPeople();
    await expect(svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true })).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
  });
});

describe("crisis", () => {
  it("answers with the fixed help text from Larry, with no model call, even without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { a, code } = await twoPeople();
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "i want to die", toLarry: true });
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
    expect(room.messages.map((m) => m.from)).toEqual([a.memberId, "larry"]);
    expect(room.messages[1].text).toBe(CRISIS_TEXT);
    expect(room.larryBusy).toBe(false);
  });

  it("also catches a crisis line in Just us mode", async () => {
    const { b, code } = await twoPeople();
    const { room } = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "I don't want to be here anymore", toLarry: false });
    expect(room.messages.at(-1)).toMatchObject({ from: "larry", text: CRISIS_TEXT });
  });

  it("runs before rate limits: a limit can't turn it away", async () => {
    const { a, code } = await twoPeople();
    const limit = vi.fn((kind: string) => {
      if (kind !== "crisis") throw new Error("limited");
    });
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "kms", toLarry: false }, { limit });
    expect(limit).toHaveBeenCalledWith("crisis");
    expect(limit).not.toHaveBeenCalledWith("message");
    expect(room.messages.at(-1)!.text).toBe(CRISIS_TEXT);
  });

  it("still shows the room when crisis lines flood in", async () => {
    const { a, code } = await twoPeople();
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "kms", toLarry: false });
    const limit = () => {
      throw new Error("limited");
    };
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "kms", toLarry: false }, { limit });
    expect(room.messages.filter((m) => m.from === "larry")).toHaveLength(1);
  });
});

describe("Larry's busy lock", () => {
  it("runs Larry once at a time; a message sent meanwhile is kept, not answered twice", async () => {
    const { a, b, code } = await twoPeople();
    let finish!: (r: GroupChatResult) => void;
    mocks.runGroupChat.mockImplementationOnce(() => new Promise<GroupChatResult>((resolve) => (finish = resolve)));

    const first = svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry, a film?", toLarry: true });
    await vi.waitFor(() => expect(mocks.runGroupChat).toHaveBeenCalledTimes(1));

    const busy = await peek(code);
    expect("room" in busy && busy.room.larryBusy).toBe(true);

    const second = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Larry, a game?", toLarry: true });
    expect(second.room.larryBusy).toBe(true);
    expect(second.room.messages.at(-1)!.text).toBe("Larry, a game?");
    expect(mocks.runGroupChat).toHaveBeenCalledTimes(1);

    finish(larryReply("Try Spirited Away."));
    const { room } = await first;
    expect(room.larryBusy).toBe(false);
    expect(room.messages.map((m) => m.text)).toEqual(["Larry, a film?", "Larry, a game?", "Try Spirited Away."]);
    expect(mocks.runGroupChat).toHaveBeenCalledTimes(1);
  });

  it("is always released, even when Larry fails", async () => {
    const { a, code } = await twoPeople();
    mocks.runGroupChat.mockRejectedValueOnce(new Error("model down"));
    await expect(svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true })).rejects.toThrow("model down");
    const r = await peek(code);
    expect("room" in r && r.room.larryBusy).toBe(false);
    expect((await memoryStore.get(code))!.larryLock).toBeUndefined();

    // And the next ask works.
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Here now."));
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(room.messages.at(-1)!.text).toBe("Here now.");
  });

  it("stops counting a lock from a run that crashed long ago", async () => {
    const { a, code } = await twoPeople();
    await memoryStore.update(code, (x) => ({ ...x, larryBusy: true, larryLock: { id: "old", since: Date.now() } }));
    expect((await peek(code)).room.larryBusy).toBe(true);
    later(svc.LARRY_LOCK_MS + 1000);
    // Phones stop showing "Larry is thinking" without anyone having to ask Larry first.
    expect((await peek(code)).room.larryBusy).toBe(false);
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Back."));
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(room.messages.at(-1)!.text).toBe("Back.");
    expect(room.larryBusy).toBe(false);
  });

  it("adds nothing when Larry stays quiet", async () => {
    const { a, code } = await twoPeople();
    mocks.runGroupChat.mockResolvedValueOnce({ messages: [], quiet: true, steps: [], profileUpdates: [] });
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(room.messages.map((m) => m.from)).toEqual([a.memberId]);
    expect(room.larryBusy).toBe(false);
  });
});

describe("Excuse Larry and Hello Larry", () => {
  it("is room-wide: every member sees Larry as away, and asking twice changes nothing", async () => {
    const { a, b, code } = await twoPeople();
    const { room } = await svc.setLarryAway(code, a.memberId, a.token, true);
    expect(room.larryAway).toBe(true);
    const seen = await svc.readRoom(code, { memberId: b.memberId, token: b.token });
    expect("room" in seen && seen.room.larryAway).toBe(true);
    const again = await svc.setLarryAway(code, b.memberId, b.token, true);
    expect(again.room.version).toBe(room.version);
  });

  it("refuses someone who isn't in the room", async () => {
    const { a, code } = await twoPeople();
    await expect(svc.setLarryAway(code, a.memberId, "wrong-token", true)).rejects.toMatchObject({ status: 403 });
    expect((await peek(code)).room.larryAway).toBeUndefined();
  });

  it("keeps messages for the people but never runs Larry or holds the budget while excused, even when asked", async () => {
    const { a, b, code } = await twoPeople();
    await svc.setLarryAway(code, a.memberId, a.token, true);
    const limit = vi.fn();
    const { room } = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Larry, what now?", toLarry: true }, { limit });
    expect(room.messages.at(-1)).toMatchObject({ from: b.memberId, text: "Larry, what now?", toLarry: false, excused: true });
    expect(room.larryBusy).toBe(false);
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
    expect(mocks.holdBudget).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith("message");
    expect(limit).not.toHaveBeenCalledWith("larry");
  });

  it("works without an API key while excused (no model is needed)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { a, code } = await twoPeople();
    await svc.setLarryAway(code, a.memberId, a.token, true);
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Just us now", toLarry: true });
    expect(room.messages.at(-1)).toMatchObject({ excused: true });
  });

  it("starts fresh after hello: Larry never reads what was said before or while it was excused", async () => {
    const { a, b, code } = await twoPeople();
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Hi both."));
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Before", toLarry: true });
    later(1000);
    await svc.setLarryAway(code, b.memberId, b.token, true);
    later(1000);
    await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "A secret while away", toLarry: false });
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Another one, to Larry", toLarry: true });
    later(1000);
    const back = await svc.setLarryAway(code, a.memberId, a.token, false);
    expect(back.room.larryAway).toBeUndefined();
    expect(back.room.larryBackAt).toBe(now);
    later(1000);
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Ask away."));
    const { room } = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry, a film?", toLarry: true });
    const history = mocks.runGroupChat.mock.calls[1][0].history;
    expect(history).toEqual([{ role: "user", content: "[Sam] Larry, a film?" }]);
    expect(JSON.stringify(history)).not.toContain("secret");
    // The people still have the whole chat.
    expect(room.messages.map((m) => m.text)).toEqual([
      "Before",
      "Hi both.",
      "A secret while away",
      "Another one, to Larry",
      "Larry, a film?",
      "Ask away.",
    ]);
  });

  it("keeps a line typed while this phone showed Larry as away, even if someone said hello meanwhile", async () => {
    const { a, b, code } = await twoPeople();
    await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "Private", toLarry: false, excused: true });
    later(1);
    mocks.runGroupChat.mockResolvedValueOnce(larryReply("Ok."));
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry?", toLarry: true });
    expect(JSON.stringify(mocks.runGroupChat.mock.calls[0][0].history)).not.toContain("Private");
  });

  it("drops Larry's reply when Larry is excused while thinking", async () => {
    const { a, b, code } = await twoPeople();
    let finish!: (r: GroupChatResult) => void;
    mocks.runGroupChat.mockImplementationOnce(() => new Promise<GroupChatResult>((resolve) => (finish = resolve)));
    const asked = svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "Larry, a film?", toLarry: true });
    await vi.waitFor(() => expect(mocks.runGroupChat).toHaveBeenCalledTimes(1));
    await svc.setLarryAway(code, b.memberId, b.token, true);
    finish(
      larryReply("Try Totoro.", {
        steps: [{ kind: "go", text: "Watch Totoro" }],
        profileUpdates: [{ memberId: b.memberId, item: { id: "q9", name: "Totoro", domain: "movie" } }],
      }),
    );
    const { room } = await asked;
    expect(room.messages.map((m) => m.text)).toEqual(["Larry, a film?"]);
    expect(room.steps).toEqual([]);
    expect(room.members.find((m) => m.id === b.memberId)!.profile.items.map((i) => i.id)).not.toContain("q9");
    expect(room.larryBusy).toBe(false);
  });

  it("gives a crisis line the helplines (crisis flag) but no Larry reply and no model call while excused", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { a, b, code } = await twoPeople();
    await svc.setLarryAway(code, a.memberId, a.token, true);
    const limit = vi.fn((kind: string) => {
      if (kind !== "crisis") throw new Error("limited");
    });
    const out = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "i want to die", toLarry: true }, { limit });
    expect(out.crisis).toBe(true);
    expect(out.room.messages.map((m) => m.from)).toEqual([b.memberId]);
    expect(out.room.messages[0]).toMatchObject({ excused: true, toLarry: false });
    expect(out.room.messages.some((m) => m.text === CRISIS_TEXT)).toBe(false);
    expect(mocks.runGroupChat).not.toHaveBeenCalled();
    // A flood still shows the helplines.
    const flood = await svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "kms", toLarry: false }, {
      limit: () => {
        throw new Error("limited");
      },
    });
    expect(flood.crisis).toBe(true);
    // And after hello, Larry doesn't read it.
    await svc.setLarryAway(code, a.memberId, a.token, false);
    expect(svc.historyFor((await memoryStore.get(code))!)).toEqual([]);
  });

  it("still answers a crisis line with the fixed help text when Larry is in", async () => {
    const { a, code } = await twoPeople();
    const out = await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "kms", toLarry: false });
    expect(out.crisis).toBe(true);
    expect(out.room.messages.at(-1)!.text).toBe(CRISIS_TEXT);
  });
});

describe("leaving and expiry", () => {
  it("removes a member who leaves; the last one out closes the room", async () => {
    const { a, b, code } = await twoPeople();
    await svc.leaveRoom(code, b.memberId, b.token);
    const r = await peek(code);
    expect("room" in r && r.room.members.map((m) => m.name)).toEqual(["Sam"]);
    await expect(svc.postMessage(code, { memberId: b.memberId, token: b.token, text: "hi", toLarry: false })).rejects.toMatchObject({
      status: 403,
    });
    await svc.leaveRoom(code, a.memberId, a.token);
    await expect(peek(code)).rejects.toMatchObject({ status: 404 });
  });

  it("expires 6 hours after the last change", async () => {
    const { a, code } = await twoPeople();
    later(ROOM_TTL_MS - 60_000);
    await svc.postMessage(code, { memberId: a.memberId, token: a.token, text: "still here", toLarry: false });
    later(ROOM_TTL_MS - 60_000);
    await expect(peek(code)).resolves.toHaveProperty("room");
    later(120_000);
    await expect(peek(code)).rejects.toMatchObject({ status: 404 });
    await expect(svc.joinRoom(code, profile("Ana"))).rejects.toMatchObject({ status: 404 });
  });
});
