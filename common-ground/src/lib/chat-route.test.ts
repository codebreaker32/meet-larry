import { afterEach, describe, expect, it, vi } from "vitest";
import { CRISIS_TEXT } from "./agent";

// No model call can happen here: there is no API key, and the crisis reply never calls it.
const { POST } = await import("@/app/api/chat/route");

const body = (text: string) => ({
  a: { name: "Sam", items: [] },
  b: { name: "Priya", items: [] },
  history: [{ role: "user", content: text }],
});
const post = (data: unknown, ip = "203.0.113.50") =>
  POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "x-real-ip": ip }, body: JSON.stringify(data) }));

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/chat crisis check", () => {
  it("answers with help even when chat isn't set up (no API key)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const res = await post(body("[Sam] i wanna die"));
    expect(res.status).toBe(200);
    const event = JSON.parse((await res.text()).trim());
    expect(event).toMatchObject({ type: "done", result: { crisis: true, messages: [{ from: "larry", text: CRISIS_TEXT }] } });
  });

  it("answers with help even when this IP is rate limited", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const ip = "203.0.113.77";
    // Burst is 8: drain it with ordinary messages (each fails setup with 503, after the limit).
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await post(body("[Sam] hello"), ip)).status;
    expect(last).toBe(429);
    const res = await post(body("I don't want to be here anymore"), ip);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"crisis":true');
  });

  it("answers with help even when the rest of the request is invalid", async () => {
    const res = await post({ history: [{ role: "user", content: "i want to kill myself" }] });
    expect(await res.text()).toContain('"crisis":true');
  });

  it("catches a crisis line said earlier in Just us mode, not only the newest turn", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const res = await post({
      ...body("x"),
      history: [
        { role: "assistant", content: "Hi both!" },
        { role: "user", content: "[Sam] I don't want to be alive anymore" },
        { role: "user", content: "[Priya] what?" },
        { role: "user", content: "[Priya] What should we watch together?" },
      ],
    }, "203.0.113.90");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"crisis":true');
  });

  it("doesn't repeat the help reply once Larry has answered after the crisis line", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const res = await post({
      ...body("x"),
      history: [
        { role: "user", content: "[Sam] i wanna die" },
        { role: "assistant", content: CRISIS_TEXT },
        { role: "user", content: "[Sam] What should we watch together?" },
      ],
    }, "203.0.113.91");
    // Not a crisis now, so it reaches setup, which has no key here.
    expect(res.status).toBe(503);
  });
});
