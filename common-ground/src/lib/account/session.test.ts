import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryRepo } from "../db/memory";
import { CHECKIN_RULES } from "../types/checkin";
import { bearerToken, getSession, isDemoAccount, isDemoPhone, sessionFromClaims, verifyRequest } from "./session";

const verifyIdToken = vi.fn();
vi.mock("../firebase/admin", () => ({
  adminAuth: () => ({ verifyIdToken }),
  hasApplicationDefaultCredentials: () => false,
}));

// Made-up numbers only (the real DEMO_PHONE lives in .env and never in the repo).
const DEMO = "+15550001234";
const OTHER = "+15550009999";

afterEach(() => vi.unstubAllEnvs());

describe("demo/testing account (D19)", () => {
  it("is recognised only by the verified phone claim matching DEMO_PHONE", () => {
    vi.stubEnv("DEMO_PHONE", DEMO);
    expect(isDemoPhone(DEMO)).toBe(true);
    expect(isDemoPhone("+1 555-000 (1234)")).toBe(true);
    expect(isDemoPhone(OTHER)).toBe(false);
    expect(isDemoPhone(undefined)).toBe(false);
    expect(isDemoPhone("")).toBe(false);
    expect(isDemoPhone(`${DEMO}0`)).toBe(false);
  });

  it("makes nobody the demo account when DEMO_PHONE is unset or malformed", () => {
    vi.stubEnv("DEMO_PHONE", "");
    expect(isDemoPhone(DEMO)).toBe(false);
    expect(isDemoPhone("")).toBe(false);
    vi.stubEnv("DEMO_PHONE", "not-a-number");
    expect(isDemoPhone("not-a-number")).toBe(false);
  });

  it("builds sessions with isDemo from the claims, and nothing a client sends", () => {
    vi.stubEnv("DEMO_PHONE", DEMO);
    const demo = sessionFromClaims({ uid: "u1", phone_number: DEMO });
    expect(demo).toEqual({ uid: "u1", isAdult: true, isDemo: true });
    expect(isDemoAccount(demo)).toBe(true);
    const real = sessionFromClaims({ uid: "u2", phone_number: OTHER });
    expect(real.isDemo).toBe(false);
    expect(isDemoAccount(real)).toBe(false);
    expect(isDemoAccount(sessionFromClaims({ uid: "u3" }))).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
    // The session never carries the phone number.
    expect(JSON.stringify(demo)).not.toContain("555");
  });

  it("keeps the real dwell at 20 minutes for everyone else", () => {
    expect(CHECKIN_RULES.minDwellMs).toBe(20 * 60_000);
    expect(Object.keys(CHECKIN_RULES)).not.toContain("demoDwellMs");
  });

});

const withToken = (t: string) => new Request("https://larry.test/api/account", { headers: { authorization: `Bearer ${t}` } });

async function makeAccount(uid: string) {
  await resetMemoryRepo().accounts.create({
    uid,
    name: "Sam",
    username: "QuietOtter42",
    createdAt: 1,
    budgetCentsLeft: 25,
    glory: 0,
    sharingWithFriends: false,
    showOnLeaderboards: false,
    publicTitleCounts: {},
    dob: { d: 1, m: 1, y: 1990 },
  });
}

describe("getSession (D18: Bearer ID token, verified with firebase-admin)", () => {
  beforeEach(() => {
    vi.stubEnv("LARRY_DB", "memory");
    verifyIdToken.mockReset();
  });

  it("is null with no token, a malformed header or a token firebase-admin rejects", async () => {
    await makeAccount("u1");
    expect(await getSession(new Request("https://larry.test/"))).toBeNull();
    expect(bearerToken(new Request("https://larry.test/", { headers: { authorization: "Basic abc" } }))).toBeNull();
    verifyIdToken.mockRejectedValueOnce(Object.assign(new Error("bad"), { code: "auth/argument-error" }));
    expect(await getSession(withToken("x"))).toBeNull();
  });

  it("builds the Session from verified claims only, and marks the demo account by its phone claim", async () => {
    vi.stubEnv("DEMO_PHONE", DEMO);
    await makeAccount("u1");
    verifyIdToken.mockResolvedValueOnce({ uid: "u1", phone_number: DEMO });
    expect(await getSession(withToken("real.jwt.token"))).toEqual({ uid: "u1", isAdult: true, isDemo: true });
    verifyIdToken.mockResolvedValueOnce({ uid: "u1", phone_number: OTHER });
    expect(await getSession(withToken("real.jwt.token"))).toEqual({ uid: "u1", isAdult: true, isDemo: false });
  });

  it("is null for a verified phone with no account yet (sign-up not done or under 18)", async () => {
    resetMemoryRepo();
    verifyIdToken.mockResolvedValueOnce({ uid: "new", phone_number: OTHER });
    expect(await getSession(withToken("real.jwt.token"))).toBeNull();
    verifyIdToken.mockResolvedValueOnce({ uid: "new", phone_number: OTHER });
    expect(await verifyRequest(withToken("real.jwt.token"))).toEqual({ uid: "new", phone_number: OTHER });
  });

  it("accepts fake e2e tokens only with E2E=1 outside production, and never as the demo account", async () => {
    await makeAccount("e2e-1");
    vi.stubEnv("E2E", "");
    expect(await getSession(withToken("e2e:e2e-1"))).toBeNull();
    vi.stubEnv("E2E", "1");
    expect(await getSession(withToken("e2e:e2e-1"))).toEqual({ uid: "e2e-1", isAdult: true, isDemo: false });
    expect(await getSession(withToken("e2e:bad/uid"))).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(await getSession(withToken("e2e:e2e-1"))).toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
