import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPii, hitsFrom, type PiiEntity } from "@/lib/aws/pii";
import { checkMessageSafety, safetyLine } from "./pii";
import { detectRedFlag } from "./red-flags";

vi.mock("server-only", () => ({}));

const ent = (text: string, span: string, Type: string, Score = 0.99): PiiEntity => {
  const BeginOffset = text.indexOf(span);
  return { Type, Score, BeginOffset, EndOffset: BeginOffset + span.length };
};

afterEach(() => vi.restoreAllMocks());

describe("hitsFrom (Comprehend entities)", () => {
  it("maps phone, email, handle and link to contact, cards to payment, Aadhaar to id", () => {
    const t = "x";
    expect(hitsFrom(t, [{ Type: "PHONE", Score: 0.95 }]).map((h) => h.kind)).toEqual(["contact"]);
    expect(hitsFrom(t, [{ Type: "CREDIT_DEBIT_NUMBER", Score: 0.95 }]).map((h) => h.kind)).toEqual(["payment"]);
    expect(hitsFrom(t, [{ Type: "IN_AADHAAR", Score: 0.95 }]).map((h) => h.kind)).toEqual(["id"]);
  });

  it("ignores names, ages, dates and weak hits", () => {
    expect(hitsFrom("x", [{ Type: "NAME", Score: 0.99 }, { Type: "AGE", Score: 0.99 }, { Type: "DATE_TIME", Score: 0.99 }, { Type: "PHONE", Score: 0.5 }])).toEqual([]);
  });

  it("counts a street address, not a neighbourhood or the venue", () => {
    const street = "I live at 14 Hill Road, Bandra";
    expect(hitsFrom(street, [ent(street, "14 Hill Road, Bandra", "ADDRESS")]).map((h) => h.kind)).toEqual(["address"]);
    const area = "I'm in Bandra today";
    expect(hitsFrom(area, [ent(area, "Bandra", "ADDRESS")])).toEqual([]);
    const venue = "See you at Dice and Tea Board Game Cafe, 2nd floor";
    expect(hitsFrom(venue, [ent(venue, "Dice and Tea Board Game Cafe, 2nd floor", "ADDRESS")], ["Dice and Tea Board Game Cafe"])).toEqual([]);
  });
});

describe("detectPii", () => {
  it("fails open (null) when the service throws, and never logs the text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await detectPii("call me on nine eight seven", {
      detect: async () => {
        throw Object.assign(new Error("boom"), { name: "TimeoutError" });
      },
    });
    expect(out).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("nine eight");
  });

  it("answers null when AWS isn't set up (unit tests never call AWS)", async () => {
    expect(await detectPii("my number is 98765 43210")).toBeNull();
  });
});

describe("checkMessageSafety", () => {
  it("steps in on the regex flags first, without asking Comprehend", async () => {
    const detect = vi.fn(async () => [] as PiiEntity[]);
    const r = await checkMessageSafety("what's your insta?", { detect });
    expect(r).toMatchObject({ flag: "contact", source: "regex" });
    expect(r.line).toBe("Let's keep numbers and addresses out of here for now. Meet at the place first.");
    expect(detect).not.toHaveBeenCalled();
  });

  it("catches money asks and scams", async () => {
    for (const t of ["can you lend me some money", "send me 500 on gpay", "what's your upi id", "invest with me in crypto", "paytm me"]) {
      expect((await checkMessageSafety(t, { detect: async () => [] })).flag, t).toBe("money");
    }
    expect(detectRedFlag("this coffee costs too much")).toBeNull();
  });

  it("asks Comprehend when the regex sees nothing: disguised numbers and emails", async () => {
    const text = "ping me at nine eight seven six five four three two one zero";
    const r = await checkMessageSafety(text, { detect: async () => [ent(text, "nine eight seven six five four three two one zero", "PHONE")], venue: "Cafe Condi" });
    expect(r).toMatchObject({ flag: "contact", source: "comprehend", reason: "contact details" });
    expect(r.line).toContain("Meet at Cafe Condi first.");
  });

  it("maps Comprehend card numbers to money and ID numbers to contact", async () => {
    expect((await checkMessageSafety("card ends four two", { detect: async () => [{ Type: "CREDIT_DEBIT_NUMBER", Score: 0.97 }] })).flag).toBe("money");
    const id = await checkMessageSafety("aadhaar is one two", { detect: async () => [{ Type: "IN_AADHAAR", Score: 0.97 }] });
    expect(id).toMatchObject({ flag: "contact", redFlag: "id" });
  });

  it("lets swapping contacts through later in a chat, but never addresses or money", async () => {
    expect((await checkMessageSafety("my insta is cool_otter", { early: false, detect: async () => [{ Type: "USERNAME", Score: 0.99 }] })).flag).toBeNull();
    const t = "come to 14 Hill Road";
    expect((await checkMessageSafety(t, { early: false, detect: async () => [ent(t, "14 Hill Road", "ADDRESS")] })).flag).toBe("address");
  });

  it("falls back to the regex answer when Comprehend fails, and says nothing for ordinary chat", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = async () => {
      throw new Error("down");
    };
    expect((await checkMessageSafety("I loved the soundtrack", { detect: down })).flag).toBeNull();
    expect((await checkMessageSafety("text me on 98765 43210", { detect: down })).flag).toBe("contact");
    expect((await checkMessageSafety("", { detect: down })).flag).toBeNull();
  });

  it("puts pressure to go somewhere private and insults under pressure", async () => {
    expect((await checkMessageSafety("let's go back to my place", { detect: async () => [] })).flag).toBe("pressure");
    expect((await checkMessageSafety("you're so stupid", { detect: async () => [] })).flag).toBe("pressure");
  });

  it("writes warm lines with no fear words", () => {
    for (const f of ["contact", "address", "id", "money", "private", "insult", "age"] as const) {
      const l = safetyLine(f, "Cafe Condi");
      expect(l).not.toMatch(/warning|danger|violation|ban|suspicious|report them/i);
      expect(l.split(/[.]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(3);
    }
  });
});
