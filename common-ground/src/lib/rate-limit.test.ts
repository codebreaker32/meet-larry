import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./rate-limit";

const req = (headers: Record<string, string>) => new Request("http://localhost/api/chat", { headers });

afterEach(() => vi.unstubAllEnvs());

describe("clientIp", () => {
  it("ignores the client-controlled first x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
  });
  it("uses a single x-forwarded-for entry, else 'local'", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({}))).toBe("local");
  });
  it("ignores client-sent x-real-ip and x-vercel-forwarded-for in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spoof = { "x-vercel-forwarded-for": "198.51.100.7", "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4, 5.6.7.8" };
    expect(clientIp(req(spoof))).toBe("5.6.7.8");
    expect(clientIp(req({ "x-real-ip": "10.0.0.1" }))).toBe("local");
  });
  it("trusts the platform headers only when told to", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_VERCEL_IP", "1");
    expect(clientIp(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.7");
    vi.stubEnv("TRUST_VERCEL_IP", "");
    vi.stubEnv("TRUST_REAL_IP", "1");
    expect(clientIp(req({ "x-vercel-forwarded-for": "198.51.100.7", "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4" }))).toBe("10.0.0.1");
  });
  it("uses x-real-ip outside production (tests and e2e)", () => {
    expect(clientIp(req({ "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("10.0.0.1");
  });
});
