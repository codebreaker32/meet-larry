import { afterEach, describe, expect, it, vi } from "vitest";

// The model is mocked: no real Anthropic call is made. Qloo is never reached.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-route-test-${process.pid}.json`;
  return { calls: 0 };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        toolRunner: () => {
          h.calls++;
          return (async function* () {
            yield { content: [{ type: "text", text: "Hi Sam, I'm Larry, an AI. Want ideas for games?" }], stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 30 } };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { POST } = await import("@/app/api/larry/route");
const { CRISIS_TEXT } = await import("./crisis");

const profile = { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] };
const post = (data: unknown, ip: string) =>
  POST(new Request("http://localhost/api/larry", { method: "POST", headers: { "x-real-ip": ip }, body: JSON.stringify(data) }));
const events = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

afterEach(async () => {
  vi.unstubAllEnvs();
  const { promises: fs } = await import("node:fs");
  await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
});

describe("POST /api/larry", () => {
  it("answers a crisis with help before setup, limits or validation, without the model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const res = await post({ history: [{ role: "user", content: "i want to kill myself" }] }, "198.51.100.1");
    expect(res.status).toBe(200);
    expect(await events(res)).toEqual([{ type: "done", result: expect.objectContaining({ crisis: true, messages: [{ from: "larry", text: CRISIS_TEXT }] }) }]);
    expect(h.calls).toBe(0);
  });

  it("catches a crisis in any message since Larry last replied", async () => {
    const res = await post(
      {
        profile,
        history: [
          { role: "assistant", content: "Hi Sam." },
          { role: "user", content: "nobody would miss me" },
          { role: "user", content: "anyway what games?" },
        ],
      },
      "198.51.100.2",
    );
    expect(await res.text()).toContain('"crisis":true');
  });

  it("says chat isn't set up when there is no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    expect((await post({ profile, history: [] }, "198.51.100.3")).status).toBe(503);
  });

  it("asks for an access code before any AI call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "");
    const res = await post({ profile, history: [] }, "198.51.100.7");
    expect(res.status).toBe(401);
    expect(h.calls).toBe(0);
  });

  it("rejects a bad body with 400", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    expect((await post({ profile: { name: "Sam" }, history: "nope" }, "198.51.100.4")).status).toBe(400);
  });

  it("streams Larry's solo reply as NDJSON", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    const res = await post({ profile, history: [], stepsDone: 1 }, "198.51.100.5");
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const [done] = await events(res);
    expect(done).toMatchObject({ type: "done", result: { messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. Want ideas for games?" }], quiet: false } });
    expect(h.calls).toBe(1);
  });

  it("is rate limited per IP", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await post({ profile, history: [] }, "198.51.100.6")).status;
    expect(last).toBe(429);
  });
});
