import { beforeEach, describe, expect, it, vi } from "vitest";

const spent = { cents: 0 };
vi.mock("./access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./access")>()),
  checkCode: vi.fn(async (code: string) => ({ ok: true, code, budgetCents: 25, spentCents: spent.cents })),
  chargeCode: vi.fn(async () => {}),
}));

const { BodyTooLargeError, CODE_RUNS_MAX, leaseCode, readBody, resetCodeLeases } = await import("./http");

beforeEach(() => {
  resetCodeLeases();
  spent.cents = 0;
});

describe("leaseCode", () => {
  it("allows only a few runs at once on one code", async () => {
    const leases = await Promise.all(Array.from({ length: 6 }, () => leaseCode("LARRY-AAAA", 0.03)));
    expect(leases.filter(Boolean)).toHaveLength(CODE_RUNS_MAX);
    leases.forEach((l) => l?.release());
    expect(await leaseCode("LARRY-AAAA", 0.03)).not.toBeNull();
  });

  it("refuses a second run once the first has reserved what is left", async () => {
    spent.cents = 24;
    const first = await leaseCode("LARRY-BBBB", 0.25);
    expect(first).not.toBeNull();
    expect(await leaseCode("LARRY-BBBB", 0.03)).toBeNull();
    first!.release();
    expect(await leaseCode("LARRY-BBBB", 0.03)).not.toBeNull();
  });

  it("frees a lease nobody released after its timeout", async () => {
    const now = Date.now();
    await leaseCode("LARRY-CCCC", 0.25, now);
    await leaseCode("LARRY-CCCC", 0.0, now);
    expect(await leaseCode("LARRY-CCCC", 0.03, now)).toBeNull();
    expect(await leaseCode("LARRY-CCCC", 0.03, now + 3 * 60 * 1000)).not.toBeNull();
  });
});

describe("readBody", () => {
  const chunked = (parts: string[]) =>
    new Request("http://localhost/api/x", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(new TextEncoder().encode(p));
          c.close();
        },
      }),
      // @ts-expect-error Node's fetch needs this for a stream body.
      duplex: "half",
    });

  it("reads a body under the cap", async () => {
    expect(await readBody(chunked(['{"a":', "1}"]), 100)).toBe('{"a":1}');
  });

  it("stops a chunked body (no Content-Length) past the cap", async () => {
    await expect(readBody(chunked(["x".repeat(60), "x".repeat(60)]), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("refuses a declared Content-Length past the cap", async () => {
    const req = new Request("http://localhost/api/x", { method: "POST", body: "x".repeat(10), headers: { "content-length": "500" } });
    await expect(readBody(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
