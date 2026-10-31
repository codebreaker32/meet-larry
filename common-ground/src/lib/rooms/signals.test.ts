import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupChatResult } from "@/lib/contracts";
import type { Profile } from "@/lib/types";

// Mood and age never reach other people (not in rooms or Open to meet). Larry (runGroupChat) and Qloo are mocked; the store is in memory. No real calls.
const mocks = vi.hoisted(() => ({ runGroupChat: vi.fn(), findGroupCommonGround: vi.fn(), holdBudget: vi.fn() }));
vi.mock("@/lib/budget", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), holdBudget: mocks.holdBudget }));
vi.mock("@/lib/agent", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), runGroupChat: mocks.runGroupChat }));
vi.mock("@/lib/qloo", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), findGroupCommonGround: mocks.findGroupCommonGround }));

const { parseRoomCode } = await import("./codes");
const { joinBodySchema, messageBodySchema } = await import("./http");
const { memoryStore, resetMemoryStore } = await import("./store");
const svc = await import("./service");
const { openBodySchema, waveBodySchema } = await import("@/lib/meet/http");

const profile = (name: string): Profile => ({ name, items: [{ id: `${name}-1`, name: `Pick of ${name}`, domain: "movie" }] });
const reply = (text: string): GroupChatResult => ({ messages: [{ from: "larry", text }], quiet: false, steps: [], profileUpdates: [] });
/** Every age range and mood word, as they could appear in a payload. */
const PRIVATE = /"(?:mood|ageBucket|age_range|signals|roomMoods)"|13-17|18-24|25-34|35-44|45\+|low-energy|"hype"|"chill"/;

beforeEach(() => {
  resetMemoryStore();
  mocks.runGroupChat.mockReset();
  mocks.findGroupCommonGround.mockReset();
  mocks.findGroupCommonGround.mockResolvedValue({ shared: [], bridges: [] });
  mocks.holdBudget.mockResolvedValue({ record: vi.fn(), check: vi.fn(), release: vi.fn() });
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
});

describe("rooms: mood blended in counts, age never kept", () => {
  it("drops the age range at the door and keeps only mood and Hidden Gems, server-side", async () => {
    const body = joinBodySchema.parse({ profile: profile("Sam"), signals: { mood: "chill", ageBucket: "18-24", hiddenGems: true } });
    expect(body.signals).toEqual({ mood: "chill", hiddenGems: true });
    const msg = messageBodySchema.parse({ memberId: "m", token: "t", text: "hi", toLarry: false, signals: { ageBucket: "13-17" } });
    expect(JSON.stringify(msg)).not.toMatch(/13-17|ageBucket/);
  });

  it("never shows anyone's mood to the room, and gives Larry only the moods with no names", async () => {
    const a = await svc.createRoom(profile("Sam"), undefined, { mood: "chill" });
    const b = await svc.joinRoom(a.room.code, profile("Priya"), undefined, { mood: "chill", hiddenGems: true });
    expect(JSON.stringify(a.room)).not.toMatch(PRIVATE);
    expect(JSON.stringify(b.room)).not.toMatch(PRIVATE);
    mocks.runGroupChat.mockResolvedValueOnce(reply("Two of you feel chill, so somewhere calm."));
    const { room } = await svc.postMessage(a.room.code, { memberId: a.memberId, token: a.token, text: "Where to?", toLarry: true, signals: { mood: "chill" } });
    const input = mocks.runGroupChat.mock.calls[0][0];
    expect(input.roomMoods).toEqual(["chill", "chill"]);
    expect(input.signals).toEqual({ hiddenGems: true });
    expect(JSON.stringify(input.members)).not.toMatch(PRIVATE);
    // What every phone reads back: no moods, no signals (Larry's own counts-only line is fine).
    const read = await svc.readRoom(a.room.code, { memberId: b.memberId, token: b.token });
    const { messages: _m, ...rest } = "room" in read ? read.room : room;
    void _m;
    expect(JSON.stringify(rest)).not.toMatch(PRIVATE);
  });

  it("forgets a member's signals when they leave", async () => {
    const a = await svc.createRoom(profile("Sam"), undefined, { mood: "hype" });
    const b = await svc.joinRoom(a.room.code, profile("Priya"), undefined, { mood: "hype" });
    await svc.leaveRoom(a.room.code, b.memberId, b.token);
    const stored = await memoryStore.get(a.room.code);
    expect(Object.keys(stored?.signals ?? {})).toEqual([a.memberId]);
  });
});

describe("Open to meet: no mood and no age in any payload", () => {
  it("the meet request schemas drop signals entirely", () => {
    const where = { lat: 19.06, lon: 72.83, accuracy: 20 };
    const open = openBodySchema.parse({
      deviceId: "device-12345",
      persona: { name: "Sam", likes: [] },
      adult: true,
      where,
      signals: { mood: "chill", ageBucket: "25-34" },
      mood: "chill",
      ageBucket: "25-34",
    });
    expect(JSON.stringify(open)).not.toMatch(PRIVATE);
    const wave = waveBodySchema.safeParse({ sessionId: "s".repeat(20), groupId: "g".repeat(10), where, mood: "chill", ageBucket: "25-34" });
    if (wave.success) expect(JSON.stringify(wave.data)).not.toMatch(PRIVATE);
  });

  it("a meet chat never stores or passes on a mood, and its room payload carries none", async () => {
    const made = await svc.createMeetRoom(
      { profile: profile("Sam"), device: "d".repeat(64) },
      { profile: profile("Priya"), device: "e".repeat(64) },
      { venueName: "Dice Cafe", shared: ["Spirited Away"] },
    );
    const [s1, s2] = made.seats;
    mocks.runGroupChat.mockResolvedValue(reply("You both like Spirited Away."));
    await svc.postMessage(made.room.code, { memberId: s1.memberId, token: s1.token, text: "Hi!", toLarry: true, signals: { mood: "low-energy" } });
    await svc.postMessage(made.room.code, { memberId: s2.memberId, token: s2.token, text: "Hey!", toLarry: true, signals: { mood: "low-energy" } });
    for (const [input] of mocks.runGroupChat.mock.calls) {
      expect(input.roomMoods).toBeUndefined();
      expect(input.signals).toBeUndefined();
    }
    const stored = await memoryStore.get(made.room.code);
    expect(stored?.signals).toBeUndefined();
    const read = await svc.readRoom(made.room.code, { memberId: s1.memberId, token: s1.token });
    expect(JSON.stringify(read)).not.toMatch(PRIVATE);
  });
});

describe("room codes (R3, server side)", () => {
  it("ignores case, spaces and punctuation, and the LARRY prefix is optional", () => {
    for (const raw of ["larry-k7qm3x", " LARRY K7QM 3X ", "Larry–K7QM.3X", "k7qm3x", "ｋ７ｑｍ３ｘ", "larry_k7-qm-3x"]) expect(parseRoomCode(raw)).toBe("K7QM3X");
    // A code that itself starts with LARRY is not cut short.
    expect(parseRoomCode("LARRY2")).toBe("LARRY2");
    expect(parseRoomCode("larry-larry2")).toBe("LARRY2");
    expect(parseRoomCode("K7QM30")).toBeNull();
    expect(parseRoomCode("")).toBeNull();
  });
});
