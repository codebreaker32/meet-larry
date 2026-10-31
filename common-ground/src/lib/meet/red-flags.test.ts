import { describe, expect, it } from "vitest";
import { detectRedFlag, stepInText } from "./red-flags";

describe("detectRedFlag", () => {
  it.each([
    ["where do you live?", "address"],
    ["What's your address", "address"],
    ["which street are you on", "address"],
    ["come back to my place", "private"],
    ["let's go somewhere private", "private"],
    ["get in my car", "private"],
    ["how old are u", "age"],
    ["are you even 18", "age"],
    ["you look so young", "age"],
    ["you're an idiot", "insult"],
    ["can you lend me some money", "money"],
    ["send me 500 rs", "money"],
    ["pls transfer ₹2000", "money"],
    ["what's your UPI id", "money"],
    ["tell me the OTP you got", "money"],
    ["can you pay for me", "money"],
    ["share your bank details", "money"],
    ["shut up", "insult"],
    ["what's your number", "contact"],
    ["add me on insta", "contact"],
    ["my snap is @cool.guy", "contact"],
    ["text me 07700 900123", "contact"],
    ["email me at a@b.com", "contact"],
  ])("%s -> %s", (text, flag) => {
    expect(detectRedFlag(text)).toBe(flag);
  });

  it.each([
    "I love Spirited Away",
    "This café is a nice place",
    "Do you play cricket?",
    "That level was stupid hard",
    "I live for this soundtrack",
    "the tickets cost money but it was worth it",
    "I paid for my own chai",
    "Money Heist is so good",
    "your card has Spirited Away on it",
    "I made an account yesterday",
  ])(
    "leaves ordinary chat alone: %s",
    (text) => {
      expect(detectRedFlag(text)).toBeNull();
    },
  );

  it("lets people swap contacts later on, but never addresses or private places", () => {
    expect(detectRedFlag("what's your insta?", false)).toBeNull();
    expect(detectRedFlag("where do you live?", false)).toBe("address");
    expect(detectRedFlag("come over to my flat", false)).toBe("private");
  });

  it("always points back to the public venue", () => {
    for (const f of ["private", "address", "contact"] as const) expect(stepInText(f, "Kettle Café")).toContain("Kettle Café");
  });
});
