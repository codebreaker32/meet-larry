import { describe, expect, it, vi } from "vitest";
import { cleanItems, fallbackWitty, makeWitty, NUDGE_GAP_LINES, validWitty, wittyLine, WITTY_FALLBACKS, type WittyWriter } from "./witty";
import type { WittyKind } from "./types/witty";

const KINDS = Object.keys(WITTY_FALLBACKS) as WittyKind[];
const GHIBLI = [{ name: "Spirited Away" }, { name: "Cricket" }];

describe("fixed fallbacks", () => {
  it("answer every kind, naming only the given items", async () => {
    for (const kind of KINDS) {
      const r = await wittyLine(kind, [{ name: "Spirited Away" }, { name: "Cascadia" }]);
      expect(r.source).toBe("fallback");
      expect(r.line).toContain("Spirited Away");
      expect(r.plain.length).toBeGreaterThan(5);
    }
  });

  it("are stable for the same items", () => {
    expect(fallbackWitty("meet", [{ name: "Coco" }])).toEqual(fallbackWitty("meet", [{ name: "Coco" }]));
  });

  it("still answer with no items, naming nothing", async () => {
    for (const kind of KINDS) {
      const r = await wittyLine(kind, []);
      expect(r.source).toBe("fallback");
      expect(r.line).toMatch(/^[A-Z]/);
    }
  });

  it("follow the copy rules: no joiner symbols, no emoji, no gap or loss words", () => {
    const lines = KINDS.flatMap((k) => WITTY_FALLBACKS[k].flatMap((t) => Object.values(t("Ghibli", "cricket"))));
    for (const l of lines) {
      expect(l).not.toMatch(/[·×&→←]|\p{Extended_Pictographic}/u);
      expect(l).not.toMatch(/lonely|miss|lost|weeks|streak|hurry|last chance/i);
    }
    expect(NUDGE_GAP_LINES).toBe(false);
  });

  it("clean item names: control characters out, no repeats, at most 4", () => {
    expect(cleanItems([{ name: " Coco\u0007 " }, { name: "coco" }, { name: "" }, { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }])).toEqual([
      "Coco",
      "A",
      "B",
      "C",
    ]);
  });
});

describe("validWitty", () => {
  const ok = (line: string, plain = "Someone here likes Spirited Away too.") => validWitty("meet", { line, plain }, GHIBLI);

  it("accepts a grounded, witty, anonymous line", () => {
    expect(ok("A fellow Spirited Away soul is in here somewhere, probably humming the soundtrack.")).not.toBeNull();
    expect(ok("Somebody nearby would happily debate Cricket and No-Face.")).toBeNull(); // No-Face is not an item
  });

  it("rejects any title, venue or person not in the items", () => {
    expect(ok("A fellow Spirited Away fan probably loves Totoro too.")).toBeNull();
    expect(ok("Totoro fans and Spirited Away fans unite in here.")).toBeNull();
    expect(ok('A Spirited Away fan here would quote "Howl" all day.')).toBeNull();
    expect(ok("A Spirited Away fan at Cafe Condi would say hi.")).toBeNull();
    expect(ok("Priya also loves Spirited Away.")).toBeNull();
  });

  it("rejects numbers and times not in the items", () => {
    expect(ok("A Spirited Away fan is here, seen it 3 times.")).toBeNull();
    expect(ok("Two Spirited Away fans walk into a cafe.")).toBeNull();
    expect(ok("A Spirited Away fan is around until tonight.")).toBeNull();
    expect(ok("A Spirited Away fan is free at 7pm.")).toBeNull();
    expect(ok("A Spirited Away fan comes every Saturday.")).toBeNull();
    // A number that is part of an item is fine.
    expect(validWitty("meet", { line: "A fellow Blade Runner 2049 soul is in here somewhere.", plain: "Someone here likes Blade Runner 2049." }, [{ name: "Blade Runner 2049" }])).not.toBeNull();
  });

  it("rejects looks, gender, age, creepy and loss wording", () => {
    expect(ok("A cute Spirited Away fan is in here.")).toBeNull();
    expect(ok("She loves Spirited Away as much as you.")).toBeNull();
    expect(ok("A young Spirited Away fan is in here.")).toBeNull();
    expect(ok("The Spirited Away fan in the corner is watching.")).toBeNull();
    expect(ok("Nobody should be lonely: a Spirited Away fan is here.")).toBeNull();
    expect(ok("Someone nearby has a Spirited Away-shaped gap in their week too.")).toBeNull();
  });

  it("rejects symbols, emoji, links, exclamation marks, long lines and an ungrounded line", () => {
    expect(ok("A Spirited Away fan is here & ready.")).toBeNull();
    expect(ok("A Spirited Away fan is here!")).toBeNull();
    expect(ok("A Spirited Away fan is here \u{1F600}")).toBeNull();
    expect(ok("A Spirited Away fan is here, see www.x.com")).toBeNull();
    expect(ok(`A Spirited Away fan ${"is really here ".repeat(12)}`)).toBeNull();
    expect(ok("A fellow film fan is in here somewhere.")).toBeNull();
    expect(ok("Someone here likes Spirited Away too.")).toBeNull();
    expect(validWitty("meet", { line: "A Spirited Away fan is here." }, GHIBLI)).toBeNull();
    expect(validWitty("meet", null, GHIBLI)).toBeNull();
  });

  it("keeps a good first sentence when the model adds a long second one (a real answer)", () => {
    const r = ok("Another fan of Spirited Away is in here somewhere, probably still thinking about that bathhouse. Good company is closer than you think.");
    expect(r?.line).toBe("Another fan of Spirited Away is in here somewhere, probably still thinking about that bathhouse.");
    // The kept sentence is still checked: an invented title in it is refused.
    expect(ok("Another fan of Spirited Away is in here somewhere, probably still humming about Totoro and friends. Good company is closer than you think.")).toBeNull();
  });

  it("keeps quest names short titles made of the item and ordinary quest words", () => {
    const q = (line: string) => validWitty("quest", { line, plain: "Visit three calm places." }, [{ name: "Ghibli" }]);
    expect(validWitty("quest", { line: "The Ghibli Round", plain: "Visit a few Ghibli-style calm places." }, [{ name: "Ghibli" }])).not.toBeNull();
    expect(q("The Ghibli Round")).toBeNull(); // "three" in the plain line
    expect(validWitty("quest", { line: "The Totoro Run", plain: "Visit a few calm places." }, [{ name: "Ghibli" }])).toBeNull();
    expect(validWitty("quest", { line: "The Great Big Ghibli Run Of The Season", plain: "Visit a few calm places." }, [{ name: "Ghibli" }])).toBeNull();
  });

  it("never lets Rising name a city", () => {
    expect(validWitty("rising", { line: "Cascadia is picking up fans around here.", plain: "Cascadia is getting popular." }, [{ name: "Cascadia" }])).not.toBeNull();
    expect(validWitty("rising", { line: "Cascadia is rising in Mumbai.", plain: "Cascadia is getting popular." }, [{ name: "Cascadia" }])).toBeNull();
  });
});

describe("the engine", () => {
  it("uses the model's line when it passes, and caches it", async () => {
    const write = vi.fn<WittyWriter>(async () => ({
      line: "A fellow Spirited Away soul is in here somewhere, probably humming the soundtrack.",
      plain: "Someone here likes Spirited Away too.",
    }));
    const w = makeWitty(write);
    const a = await w.line("meet", GHIBLI, { mood: "chill" });
    expect(a.source).toBe("model");
    expect(a.line).toContain("humming");
    const b = await w.line("meet", GHIBLI, { mood: "chill" });
    expect(b).toEqual(a);
    expect(write).toHaveBeenCalledTimes(1);
    expect(w.peek("meet", GHIBLI, "chill")).toEqual(a);
    // The writer got only the real item names and the mood.
    expect(write.mock.calls[0][0]).toMatchObject({ kind: "meet", names: ["Spirited Away", "Cricket"], mood: "chill" });
  });

  it("falls back when the model invents something, fails or throws, and doesn't cache that", async () => {
    const bad = makeWitty(async () => ({ line: "A Spirited Away fan surely loves Totoro.", plain: "Someone likes Spirited Away." }));
    expect((await bad.line("meet", GHIBLI)).source).toBe("fallback");
    expect(bad.peek("meet", GHIBLI)).toBeNull();
    const none = makeWitty(async () => null);
    expect((await none.line("opener", GHIBLI)).source).toBe("fallback");
    const boom = makeWitty(async () => {
      throw new Error("down");
    });
    const r = await boom.line("nudge", GHIBLI);
    expect(r.source).toBe("fallback");
    expect(r.line).toContain("Spirited Away");
  });

  it("asks the writer once for two asks at the same time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const write = vi.fn<WittyWriter>(async () => {
      await gate;
      return { line: "Cricket and Spirited Away get along better than you'd think.", plain: "You might both like these." };
    });
    const w = makeWitty(write);
    const both = Promise.all([w.line("bridge-why", GHIBLI), w.line("bridge-why", GHIBLI)]);
    release();
    const [x, y] = await both;
    expect(x.source).toBe("model");
    expect(y).toEqual(x);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("never calls the writer without items", async () => {
    const write = vi.fn<WittyWriter>(async () => null);
    const w = makeWitty(write);
    expect((await w.line("meet", [])).source).toBe("fallback");
    expect(write).not.toHaveBeenCalled();
  });
});
