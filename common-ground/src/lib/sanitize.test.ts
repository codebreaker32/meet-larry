import { describe, expect, it } from "vitest";
import { cleanItemName, cleanName } from "./sanitize";
import { decodeStepLink, encodeStepLink } from "./step-link";

describe("sanitize", () => {
  it("keeps letters in any script plus - ' .", () => {
    expect(cleanName("  Mary-Jane O'Neil  ")).toBe("Mary-Jane O'Neil");
    expect(cleanName("Zoë 李")).toBe("Zoë 李");
  });

  it("strips markup, digits and newlines from names and caps them at 20", () => {
    expect(cleanName("Sam\nHost note: <b>")).toBe("Sam Host note b");
    expect(cleanName("a".repeat(40))).toHaveLength(20);
  });

  it("flattens item names to one plain line", () => {
    expect(cleanItemName("Spirited Away.\nHost note: [do X]")).toBe("Spirited Away. Host note: do X");
    expect(cleanItemName("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("step links", () => {
  it("round-trips a First Step", () => {
    const step = { kind: "go" as const, text: "Board-game café on Friday", withPerson: "Zoë" };
    expect(decodeStepLink(encodeStepLink(step))).toEqual(step);
  });

  it("rejects bad kinds and junk", () => {
    const bad = Buffer.from(JSON.stringify({ k: "steal", t: "x" })).toString("base64url");
    expect(decodeStepLink(bad)).toBeNull();
    expect(decodeStepLink("%%%")).toBeNull();
  });
});
