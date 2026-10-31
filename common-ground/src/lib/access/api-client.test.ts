import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_CODE_KEY, ACCESS_EVENT, apiFetch, getAccessCode, saveAccessCode } from "../api-client";
import { ACCESS_HEADER, CODE_HEADER } from "./shared";

// A tiny browser: localStorage and window events, enough for the client helper.
let storage: Map<string, string>;
let events: Event[];

beforeEach(() => {
  storage = new Map();
  events = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal("window", {
    dispatchEvent: (e: Event) => (events.push(e), true),
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("sends the saved code in the x-larry-code header, keeping other headers", async () => {
    saveAccessCode("larry 7k2p q9xm");
    expect(storage.get(ACCESS_CODE_KEY)).toBe("LARRY-7K2P-Q9XM");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/larry", { method: "POST", headers: { "content-type": "application/json" } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = new Headers(init.headers);
    expect(h.get(CODE_HEADER)).toBe("LARRY-7K2P-Q9XM");
    expect(h.get("content-type")).toBe("application/json");
  });

  it("sends no header without a code, so routes that need no AI work as before", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/search?q=dune");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).has(CODE_HEADER)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("tells the page when an AI route asks for a code", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 402, headers: { [ACCESS_HEADER]: "spent" } }));
    const res = await apiFetch("/api/larry", { method: "POST" });
    expect(res.status).toBe(402);
    const e = events.find((x) => x.type === ACCESS_EVENT) as CustomEvent;
    expect(e.detail).toEqual({ state: "spent" });
  });

  it("does not open the prompt for other 401s (room tokens and the like)", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await apiFetch("/api/rooms/ABC");
    expect(events.filter((x) => x.type === ACCESS_EVENT)).toHaveLength(0);
  });

  it("adds the account's Bearer token when this device is signed in", async () => {
    vi.doMock("@/lib/firebase/client", () => ({ authHeader: async () => ({ authorization: "Bearer tok123" }) }));
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/larry", { method: "POST" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok123");
    vi.doUnmock("@/lib/firebase/client");
  });

  it("ignores a stored value that isn't a code", () => {
    storage.set(ACCESS_CODE_KEY, "<script>");
    expect(getAccessCode()).toBeNull();
  });
});
