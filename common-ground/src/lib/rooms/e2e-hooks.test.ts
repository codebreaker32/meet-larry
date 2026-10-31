import { afterEach, describe, expect, it, vi } from "vitest";
import { e2eGround, e2eLarry } from "./e2e-hooks";

const req = (headers: Record<string, string>) => new Request("http://localhost/api/rooms/ABCDEF/messages", { method: "POST", headers });
const larry = { "x-e2e-larry": encodeURIComponent(JSON.stringify({ text: "Hi from the test." })) };

afterEach(() => vi.unstubAllEnvs());

describe("e2e test hooks", () => {
  it("do nothing outside a development server, so production ignores the headers", () => {
    for (const env of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(e2eLarry(req(larry))).toBeUndefined();
      expect(e2eGround(req({ "x-e2e-fake-qloo": "1" }))).toBeUndefined();
    }
  });

  it("on a dev server, answer for Larry and build ground from the cards without Qloo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(e2eLarry(req({}))).toBeUndefined();
    const run = e2eLarry(req(larry))!;
    const out = await run({ mode: "group", members: [], history: [] });
    expect(out.messages).toEqual([{ from: "larry", text: "Hi from the test." }]);

    const find = e2eGround(req({ "x-e2e-fake-qloo": "1" }))!;
    const a = { id: "a", name: "Sam", color: "", profile: { name: "Sam", items: [{ id: "x", name: "Minecraft", domain: "videogame" as const }] } };
    const b = { id: "b", name: "Priya", color: "", profile: { name: "Priya", items: [{ id: "x", name: "Minecraft", domain: "videogame" as const }] } };
    const g = await find([a, b]);
    expect(g.shared).toEqual([{ item: a.profile.items[0], memberIds: ["a", "b"] }]);
    expect(Object.keys(g.bridges[0].from)).toEqual(["a", "b"]);
  });
});
