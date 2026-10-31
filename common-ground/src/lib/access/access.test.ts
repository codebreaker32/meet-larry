import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashAccessCode, newAccessCode, usdToCents } from "./codes";
import {
  CodeSpentError,
  DEV_CODE,
  accessDenied,
  chargeCode,
  checkCode,
  codeHold,
  requireCode,
  resetMisses,
} from "./index";
import { ACCESS_CODE_ALPHABET, ACCESS_HEADER, ACCESS_TEXT, CODE_HEADER, normalizeAccessCode } from "./shared";
import { fileCodeStore, getCodeStore } from "./store";

const dir = mkdtempSync(path.join(os.tmpdir(), "larry-codes-"));
let n = 0;
let file: string;

const req = (code?: string, ip = "1.2.3.4") =>
  new Request("http://localhost/api/larry", {
    method: "POST",
    headers: { ...(code === undefined ? {} : { [CODE_HEADER]: code }), "x-real-ip": ip },
  });

async function addCode(cents = 25, spent = 0): Promise<string> {
  const code = newAccessCode();
  await getCodeStore().add([{ hash: hashAccessCode(code)!, record: { budgetCents: cents, spentCents: spent, createdAt: 1 } }]);
  return code;
}

beforeEach(() => {
  file = path.join(dir, `codes-${n++}.json`);
  vi.stubEnv("ACCESS_CODES_FILE", file);
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("LARRY_ALLOW_NO_CODE", "");
  resetMisses();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("codes and hashing", () => {
  it("makes readable codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newAccessCode();
      expect(code).toMatch(new RegExp(`^LARRY-[${ACCESS_CODE_ALPHABET}]{4}-[${ACCESS_CODE_ALPHABET}]{4}$`));
      expect(code.slice(6)).not.toMatch(/[01OI]/);
    }
  });

  it("accepts the code however it is typed", () => {
    expect(normalizeAccessCode("larry-7k2p-q9xm")).toBe("LARRY-7K2P-Q9XM");
    expect(normalizeAccessCode(" Larry 7K2P Q9XM ")).toBe("LARRY-7K2P-Q9XM");
    expect(normalizeAccessCode("7k2pq9xm")).toBe("LARRY-7K2P-Q9XM");
    expect(normalizeAccessCode("LARRY-7K2P–Q9XM")).toBe("LARRY-7K2P-Q9XM"); // en dash from a phone keyboard
  });

  it("rejects anything that can't be a code", () => {
    for (const bad of ["", "LARRY", "LARRY-7K2P-Q9", "LARRY-7K2P-Q9XMA", "LARRY-0K2P-Q9XM", "LARRY-IK2P-Q9XM", "x".repeat(100), 42, null]) {
      expect(normalizeAccessCode(bad)).toBeNull();
    }
  });

  it("hashes every spelling of a code the same, and never stores the code itself", async () => {
    const h = hashAccessCode("LARRY-7K2P-Q9XM");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessCode("larry 7k2p q9xm")).toBe(h);
    expect(hashAccessCode("LARRY-7K2P-Q9XN")).not.toBe(h);
    expect(hashAccessCode("nope")).toBeNull();

    const code = await addCode();
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(code);
    expect(raw).not.toContain(code.replace(/-/g, ""));
    expect(raw).toContain(hashAccessCode(code)!);
  });

  it("converts dollars to cents and ignores nonsense", () => {
    expect(usdToCents(0.25)).toBeCloseTo(25);
    expect(usdToCents(-1)).toBe(0);
    expect(usdToCents(Number.NaN)).toBe(0);
  });
});

describe("requireCode", () => {
  it("lets a valid code through, in its canonical form", async () => {
    const code = await addCode();
    const res = await requireCode(req(code.toLowerCase()));
    expect(res).toEqual({ code });
  });

  it("answers 401 without a code", async () => {
    const res = await requireCode(req());
    expect(res).toBeInstanceOf(Response);
    const r = res as Response;
    expect(r.status).toBe(401);
    expect(r.headers.get(ACCESS_HEADER)).toBe("missing");
    expect((await r.json()).access).toBe("missing");
  });

  it("answers 401 for an unknown or malformed code", async () => {
    await addCode();
    for (const bad of ["LARRY-2222-2222", "hello"]) {
      const r = (await requireCode(req(bad))) as Response;
      expect(r.status).toBe(401);
      expect(r.headers.get(ACCESS_HEADER)).toBe("invalid");
    }
  });

  it("answers 402 with the agreed message once the budget is spent", async () => {
    const code = await addCode(25, 25);
    const r = (await requireCode(req(code))) as Response;
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: ACCESS_TEXT.spent, access: "spent" });
  });

  it("stops guessing after too many wrong codes from one client", async () => {
    for (let i = 0; i < 20; i++) await requireCode(req(newAccessCode(), "9.9.9.9"));
    const r = (await requireCode(req(newAccessCode(), "9.9.9.9"))) as Response;
    expect(r.status).toBe(429);
    // Another client is unaffected.
    expect(((await requireCode(req(newAccessCode(), "8.8.8.8"))) as Response).status).toBe(401);
  });

  it("allows no code in development with LARRY_ALLOW_NO_CODE=1, and never charges it", async () => {
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(await requireCode(req())).toEqual({ code: DEV_CODE });
    await expect(chargeCode(DEV_CODE, 5)).resolves.toBeUndefined();
    // A real code still counts as itself.
    const code = await addCode();
    expect(await requireCode(req(code))).toEqual({ code });
  });

  it("ignores LARRY_ALLOW_NO_CODE in production", async () => {
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(((await requireCode(req())) as Response).status).toBe(401);
  });

  it("accessDenied uses 402 only for spent codes", () => {
    expect(accessDenied("missing").status).toBe(401);
    expect(accessDenied("invalid").status).toBe(401);
    expect(accessDenied("spent").status).toBe(402);
  });
});

describe("charging", () => {
  it("adds spend until the code is used up", async () => {
    const code = await addCode(25);
    await chargeCode(code, 0.1);
    let c = await checkCode(code);
    expect(c.ok && c.spentCents).toBeCloseTo(10);
    await chargeCode(code, 0.1);
    expect((await checkCode(code)).ok).toBe(true);
    await chargeCode(code, 0.05);
    c = await checkCode(code);
    expect(c).toEqual({ ok: false, state: "spent" });
    expect(((await requireCode(req(code))) as Response).status).toBe(402);
  });

  it("charges atomically: many charges at once all count", async () => {
    const code = await addCode(1000);
    await Promise.all(Array.from({ length: 40 }, () => chargeCode(code, 0.01)));
    const c = await checkCode(code);
    expect(c.ok && c.spentCents).toBeCloseTo(40, 6);
  });

  it("two stores on the same file (two processes) don't lose charges", async () => {
    const code = await addCode(1000);
    const hash = hashAccessCode(code)!;
    const a = fileCodeStore(file);
    // A different path string for the same file, so the in-process queue isn't shared: only the lock file protects it.
    const b = fileCodeStore(path.relative(process.cwd(), file));
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).charge(hash, 1)));
    expect((await a.get(hash))?.spentCents).toBe(20);
  });

  it("ignores charges for unknown codes and never throws", async () => {
    await expect(chargeCode("LARRY-2222-2222", 1)).resolves.toBeUndefined();
    await expect(chargeCode("not a code", 1)).resolves.toBeUndefined();
  });

  it("does not add codes twice", async () => {
    const store = getCodeStore();
    const hash = hashAccessCode(newAccessCode())!;
    const rec = { budgetCents: 25, spentCents: 0, createdAt: 1 };
    expect(await store.add([{ hash, record: rec }])).toBe(1);
    await store.charge(hash, 5);
    expect(await store.add([{ hash, record: rec }])).toBe(0);
    expect((await store.get(hash))?.spentCents).toBe(5);
  });

  it("refuses to read a broken file as empty (which would reset every budget)", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{not json");
    await expect(getCodeStore().get(hashAccessCode(newAccessCode())!)).rejects.toThrow(/not valid JSON/);
    expect(((await requireCode(req(newAccessCode()))) as Response).status).toBe(503);
  });
});

describe("codeHold", () => {
  const base = () => ({
    record: vi.fn(async () => 1),
    check: vi.fn(async () => {}),
    release: vi.fn(),
  });

  it("charges each model response to the code and stops the run once it is spent", async () => {
    const code = await addCode(1);
    const b = base();
    const hold = codeHold(code, b);
    // 1,000 output tokens at $20 per million = $0.02 = 2 cents: over a 1-cent budget.
    await hold.record({ input_tokens: 0, output_tokens: 1000 });
    expect(b.record).toHaveBeenCalledOnce();
    await expect(hold.check()).rejects.toBeInstanceOf(CodeSpentError);
    hold.release();
    expect(b.release).toHaveBeenCalledOnce();
  });

  it("lets the run go on while the code has time left", async () => {
    const code = await addCode(25);
    const hold = codeHold(code, base());
    await hold.record({ input_tokens: 1000, output_tokens: 100 });
    await expect(hold.check()).resolves.toBeUndefined();
  });
});

describe("accounts pay with their own Larry time", () => {
  const bearerReq = (uid: string, code?: string) =>
    new Request("http://localhost/api/larry", {
      method: "POST",
      headers: { authorization: `Bearer e2e:${uid}`, "x-real-ip": "9.9.9.9", ...(code ? { [CODE_HEADER]: code } : {}) },
    });

  async function account(uid: string, budgetCentsLeft = 25) {
    const { resetMemoryRepo } = await import("../db/memory");
    const repo = resetMemoryRepo();
    await repo.accounts.create({
      uid,
      name: "Sam",
      username: "QuietOtter42",
      createdAt: 1,
      budgetCentsLeft,
      glory: 0,
      sharingWithFriends: false,
      showOnLeaderboards: false,
      publicTitleCounts: {},
      dob: { d: 1, m: 1, y: 1990 },
    });
    return repo;
  }

  beforeEach(() => {
    vi.stubEnv("E2E", "1");
    vi.stubEnv("LARRY_DB", "memory");
  });

  it("requireCode accepts a Bearer token and charges acct:<uid>", async () => {
    const repo = await account("u1");
    const got = await requireCode(bearerReq("u1"));
    expect(got).toEqual({ code: "acct:u1" });
    await chargeCode("acct:u1", 0.05);
    expect((await repo.accounts.get("u1"))!.budgetCentsLeft).toBeCloseTo(20);
    const check = await checkCode("acct:u1");
    expect(check).toMatchObject({ ok: true, budgetCents: 25 });
  });

  it("never takes the budget below 0, and a spent account hears the warm budget line", async () => {
    const repo = await account("u2", 1);
    await chargeCode("acct:u2", 5);
    expect((await repo.accounts.get("u2"))!.budgetCentsLeft).toBe(0);
    const r = await requireCode(bearerReq("u2"));
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(402);
    expect(await (r as Response).json()).toMatchObject({ error: ACCESS_TEXT.spent, access: "spent" });
  });

  it("falls back to an access code when the account's time is spent", async () => {
    await account("u3", 0);
    const code = await addCode();
    expect(await requireCode(bearerReq("u3", code))).toEqual({ code });
  });

  it("refuses account codes sent as a header, and bearer tokens without an account", async () => {
    await account("u4");
    const forged = await requireCode(req("acct:u4"));
    expect(forged).toBeInstanceOf(Response);
    expect((forged as Response).status).toBe(401);
    const noAccount = await requireCode(bearerReq("nobody"));
    expect((noAccount as Response).status).toBe(401);
  });

  it("ignores fake e2e tokens unless E2E=1 outside production", async () => {
    await account("u5");
    vi.stubEnv("E2E", "");
    expect((await requireCode(bearerReq("u5"))) as Response).toBeInstanceOf(Response);
  });
});
