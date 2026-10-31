import { describe, expect, it } from "vitest";
import { cleanReply, looksLikeCrisis, toMessages } from "./agent";
import { DEMO_PRIYA, DEMO_SAM } from "./demo";

describe("crisis check", () => {
  const crisis = [
    "i wanna die",
    "I want to kill myself",
    "i want to hang myself",
    "i feel like dying",
    "I've been cutting myself",
    "i don't want to be here",
    "honestly I don't see the point anymore",
    "nobody would care if i disappeared",
    "[Priya] i might end it all",
  ];
  const ordinary = [
    "Lets take it all in, what a view",
    "Better Off Dead is a 1985 film",
    "Overdose by EXO slaps",
    "nobody would notice if we left early",
    "this boss fight, I'm ready to die again",
    "this game is killing me",
    "I died laughing",
    "Suicide Squad was bad",
  ];
  it.each(crisis)("catches %j", (t) => expect(looksLikeCrisis(t)).toBe(true));
  it.each(ordinary)("lets %j through", (t) => expect(looksLikeCrisis(t)).toBe(false));
});

describe("reply cleaning", () => {
  it("removes links, emails, phone numbers and markdown", () => {
    const out = cleanReply("**Try** the gift at qloo-gifts.example.com or call +91 98200 12345, email a@b.co");
    expect(out).not.toMatch(/qloo-gifts|98200|a@b\.co|\*\*/);
  });

  it("keeps years in titles", () => {
    expect(cleanReply("Blade Runner 2049 (2017) is great")).toContain("2049 (2017)");
  });
});

describe("toMessages", () => {
  it("starts and ends on a user turn and keeps the cards in a data block", () => {
    const msgs = toMessages(
      [
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "[Sam] hey" },
        { role: "assistant", content: "[quiet]" },
      ],
      DEMO_SAM,
      DEMO_PRIYA,
    );
    expect(msgs[0].role).toBe("user");
    expect(msgs.at(-1)?.role).toBe("user");
    for (let i = 1; i < msgs.length; i++) expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    expect(JSON.stringify(msgs[0].content)).toContain("taste_cards");
  });
});
