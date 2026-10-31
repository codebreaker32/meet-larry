import { describe, expect, it } from "vitest";
import {
  ALIAS_ADJECTIVES,
  ALIAS_NOUNS,
  ALIAS_RE,
  aliasName,
  myAlias,
  newDeviceSecret,
  PODIUM_HEX_RE,
  podiumIdFor,
  podiumKey,
  randomAlias,
  sha256Hex,
} from "./alias";

const SECRET = "c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTEyMzQ"; // fixed test secret (base64url)
const CAFE = "E2E00000-0000-4000-8000-0000000000C1";
const BOOKS = "E2E00000-0000-4000-8000-0000000000C2";

// Common first names (English and Indian) that an alias must never contain as a word.
const REAL_NAMES = [
  "aarav", "aditi", "amber", "amit", "ananya", "anjali", "arjun", "aspen", "basil", "bella", "coral", "daisy", "dawn",
  "drake", "ember", "finch", "grace", "hazel", "iris", "ivy", "jade", "jasper", "jay", "kabir", "kavya", "lily", "maya",
  "meera", "mira", "neha", "olive", "pearl", "priya", "rahul", "raven", "riya", "robin", "rohan", "rose", "ruby", "sage",
  "sam", "sandy", "sky", "summer", "sunny", "tara", "willow", "wren", "zara", "martin", "hunter", "honey", "misty",
  "lucky", "indigo", "autumn", "april", "june", "rain", "river", "storm", "blaze", "max", "leo", "kiran", "asha",
];

describe("podium keys", () => {
  it("gives the same key, id and name for the same inputs", async () => {
    const k1 = await podiumKey(SECRET, CAFE, 0);
    const k2 = await podiumKey(SECRET, CAFE, 0);
    expect(k1).toBe(k2);
    expect(k1).toMatch(PODIUM_HEX_RE);
    const id = await podiumIdFor(k1);
    expect(id).toMatch(PODIUM_HEX_RE);
    expect(id).not.toBe(k1);
    expect(id).toBe(await sha256Hex(k1));
    expect(await myAlias(SECRET, CAFE)).toBe(aliasName(id));
  });

  it("gives a different name at a different place", async () => {
    expect(await myAlias(SECRET, CAFE)).not.toBe(await myAlias(SECRET, BOOKS));
  });

  it("changes the name on a re-roll", async () => {
    const names = new Set(await Promise.all([0, 1, 2, 3].map((r) => myAlias(SECRET, CAFE, r))));
    expect(names.size).toBe(4);
  });

  it("depends on the device secret", async () => {
    expect(await podiumKey(newDeviceSecret(), CAFE)).not.toBe(await podiumKey(SECRET, CAFE));
  });

  it("rejects bad input", async () => {
    await expect(podiumKey("", CAFE)).rejects.toThrow();
    await expect(podiumKey(SECRET, CAFE, -1)).rejects.toThrow();
    await expect(podiumIdFor("QuietOtter42")).rejects.toThrow();
    expect(() => aliasName("not-hex")).toThrow();
  });

  it("makes 32-byte device secrets", () => {
    const s = newDeviceSecret();
    expect(s).toMatch(/^[\w-]{43}$/);
    expect(newDeviceSecret()).not.toBe(s);
  });
});

describe("alias names", () => {
  it("follow the AdjectiveNoun42 pattern", async () => {
    expect(aliasName("0".repeat(64))).toBe("QuietOtter2");
    for (let i = 0; i < 200; i++) expect(randomAlias()).toMatch(ALIAS_RE);
  });

  it("never use a word that reads as a real name", () => {
    const words = [...ALIAS_ADJECTIVES, ...ALIAS_NOUNS].map((w) => w.toLowerCase());
    for (const name of REAL_NAMES) expect(words, name).not.toContain(name);
    expect(new Set(words).size).toBe(words.length);
  });

  it("spread across the word lists", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(randomAlias().replace(/\d+$/, ""));
    expect(seen.size).toBeGreaterThan(400);
  });
});
