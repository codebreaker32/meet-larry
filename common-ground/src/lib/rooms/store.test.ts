import { afterEach, describe, expect, it, vi } from "vitest";
import { type StoredRoom, getRoomStore, memoryStore, upstashStore } from "./store";

// The Upstash REST store against a tiny fake Redis behind a mocked fetch: no network.

function fakeRedis() {
  const data = new Map<string, string>();
  const calls: string[][] = [];
  let interfere = 0;
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const args = JSON.parse(String(init?.body)) as string[];
    calls.push(args);
    const [cmd, ...rest] = args;
    let result: unknown = null;
    if (cmd === "GET") result = data.get(rest[0]) ?? null;
    else if (cmd === "SET") {
      const [key, value] = rest;
      if (rest.includes("NX") && data.has(key)) result = null;
      else {
        data.set(key, value);
        result = "OK";
      }
    } else if (cmd === "DEL") result = data.delete(rest[0]) ? 1 : 0;
    else if (cmd === "EVAL") {
      const [, , key, rev, value] = rest;
      const cur = data.get(key);
      if (interfere > 0) {
        // Someone else writes between our GET and our compare-and-set.
        interfere--;
        const other = JSON.parse(cur!) as StoredRoom;
        data.set(key, JSON.stringify({ ...other, rev: other.rev + 1, version: other.version + 1 }));
        result = 0;
      } else if (!cur) result = -1;
      else result = (JSON.parse(cur) as StoredRoom).rev === Number(rev) ? (data.set(key, value), 1) : 0;
    }
    return Response.json({ result });
  });
  return { data, calls, fetchMock, interfereOnce: () => (interfere = 1) };
}

const room = (code: string): StoredRoom => ({
  code,
  createdAt: 1,
  members: [],
  messages: [],
  steps: [],
  version: 1,
  larryBusy: false,
  tokenHashes: {},
  names: {},
  rev: 1,
  updatedAt: 1,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upstash store", () => {
  it("creates once per code, reads, updates with compare-and-set, and deletes", async () => {
    const redis = fakeRedis();
    vi.stubGlobal("fetch", redis.fetchMock);
    const store = upstashStore("https://example.upstash.io/", "secret-token");

    expect(await store.create(room("ABCDEF"))).toBe(true);
    expect(await store.create(room("ABCDEF"))).toBe(false);
    expect(redis.calls[0]).toEqual(["SET", "larry:room:ABCDEF", expect.any(String), "NX", "PX", String(6 * 60 * 60 * 1000)]);
    const init = redis.fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(redis.fetchMock.mock.calls[0][0]).toBe("https://example.upstash.io");

    const saved = await store.update("ABCDEF", (r) => ({ ...r, version: r.version + 1 }));
    expect(saved).toMatchObject({ version: 2, rev: 2 });
    expect((await store.get("ABCDEF"))!.version).toBe(2);

    // Lost race: reads again and applies the change on top of the other write.
    redis.interfereOnce();
    const again = await store.update("ABCDEF", (r) => ({ ...r, version: r.version + 1 }));
    expect(again).toMatchObject({ version: 4, rev: 4 });

    expect(await store.update("NOPE22", (r) => r)).toBeNull();
    await store.delete("ABCDEF");
    expect(await store.get("ABCDEF")).toBeNull();
  });

  it("reports storage errors without the URL or token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WRONGPASS" }, { status: 401 })));
    const store = upstashStore("https://example.upstash.io", "secret-token");
    const err = await store.get("ABCDEF").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toMatch(/secret-token|example\.upstash/);
  });

  it("is used only when both env vars are set", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(getRoomStore()).toBe(memoryStore);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    expect(getRoomStore()).toBe(memoryStore);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    expect(getRoomStore()).not.toBe(memoryStore);
  });
});
