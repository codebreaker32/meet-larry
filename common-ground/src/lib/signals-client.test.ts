// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { recentPlaceIds, recentPlacesField, requestSignals, saveHiddenGems, saveMood, signalsField, MOOD_INFO } from "./mood";
import { AGE_LABELS, bucketForAge, canOpenToMeet, roomsByCodeOnly, saveAgeBucket, saveAgeFromAccount } from "./age";
import { AGE_BUCKETS, MOODS } from "./types/signals";
import { joinHeard, SPEECH_HONESTY, SPEECH_LANGS, SPEECH_UNSUPPORTED } from "./use-speech";
import { cleanCodeInput, hasLookalike, normalizeCode } from "@/components/meet-chat/room-api";

beforeEach(() => localStorage.clear());

describe("mood and Hidden Gems on the device", () => {
  it("has the glossary word and meaning for every mood", () => {
    for (const m of MOODS) expect(MOOD_INFO[m].label && MOOD_INFO[m].meaning).toBeTruthy();
    expect(MOOD_INFO["low-energy"].label).toBe("Low energy");
  });

  it("sends nothing when nothing is set", () => {
    expect(requestSignals()).toEqual({});
    expect(signalsField()).toEqual({});
  });

  it("sends mood, age range and Hidden Gems with the person's own requests", () => {
    saveMood("curious");
    saveAgeBucket("18-24");
    saveHiddenGems(true);
    expect(signalsField()).toEqual({ signals: { mood: "curious", ageBucket: "18-24", hiddenGems: true } });
  });

  it("clears a mood and Hidden Gems", () => {
    saveMood("hype");
    saveHiddenGems(true);
    saveMood(null);
    saveHiddenGems(false);
    expect(requestSignals()).toEqual({});
  });

  it("ignores junk a device may hold", () => {
    localStorage.setItem("larry.mood", JSON.stringify("angry"));
    localStorage.setItem("larry.ageBucket", "not json");
    localStorage.setItem("larry.hiddenGems", JSON.stringify("yes"));
    expect(requestSignals()).toEqual({});
  });
});

describe("age ranges and under-18 gating", () => {
  it("offers exactly the five ranges, never under 13", () => {
    expect(AGE_BUCKETS.map((b) => AGE_LABELS[b])).toEqual(["13–17", "18–24", "25–34", "35–44", "45+"]);
  });

  it("maps whole years to a range, and under 13 to none", () => {
    expect(bucketForAge(12)).toBeNull();
    expect(bucketForAge(13)).toBe("13-17");
    expect(bucketForAge(17)).toBe("13-17");
    expect(bucketForAge(18)).toBe("18-24");
    expect(bucketForAge(34)).toBe("25-34");
    expect(bucketForAge(44)).toBe("35-44");
    expect(bucketForAge(70)).toBe("45+");
  });

  it("lets a signed-in account's age decide the device range", () => {
    saveAgeBucket("13-17");
    expect(saveAgeFromAccount(19)).toBe(true);
    expect(requestSignals().ageBucket).toBe("18-24");
  });

  it("hides Open to meet and keeps rooms code-only under 18 or with no age", () => {
    for (const b of [null, undefined, "13-17"] as const) {
      expect(canOpenToMeet(b)).toBe(false);
      expect(roomsByCodeOnly(b)).toBe(true);
    }
    for (const b of ["18-24", "25-34", "35-44", "45+"] as const) {
      expect(canOpenToMeet(b)).toBe(true);
      expect(roomsByCodeOnly(b)).toBe(false);
    }
  });
});

describe("room codes typed the forgiving way (R3)", () => {
  it("takes any case, spaces, dashes, an optional LARRY- and a pasted link", () => {
    for (const raw of ["LARRY-7KQ2MX", "larry 7kq2mx", "7kq2mx", " 7KQ 2MX ", "Larry-7kq-2mx", "https://x.app/room/7kq2mx?x=1"]) {
      expect(normalizeCode(raw)).toBe("7KQ2MX");
    }
  });

  it("treats O as 0 and I as 1, and says so instead of joining a wrong room", () => {
    expect(cleanCodeInput("ab0o1i")).toBe("AB0011");
    expect(hasLookalike("abcdeo")).toBe(true);
    expect(hasLookalike("ABCDE2")).toBe(false);
    expect(normalizeCode("ABCDEO")).toBeNull();
  });

  it("rejects codes of the wrong length", () => {
    expect(normalizeCode("7KQ2M")).toBeNull();
    expect(normalizeCode("7KQ2MXX")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});

describe("speech-to-text words", () => {
  it("joins heard words with one space", () => {
    expect(joinHeard("", "hello")).toBe("hello");
    expect(joinHeard("I like ", " board games")).toBe("I like board games");
    expect(joinHeard("done", "")).toBe("done");
  });

  it("offers English (India) and Hindi, an honesty line and a tip when unsupported", () => {
    expect(SPEECH_LANGS.map((l) => l.value)).toEqual(["en-IN", "hi-IN"]);
    expect(SPEECH_HONESTY).toBe("Your browser turns speech into text (Google in Chrome, Apple in Safari).");
    expect(SPEECH_UNSUPPORTED).toBe("Open in Chrome or Safari to use the mic.");
  });
});

describe("recent places (stop repeating the same spots)", () => {
  it("sends the ids of saved plans, newest first, and never visits", () => {
    expect(recentPlacesField()).toEqual({});
    localStorage.setItem("cg.steps", JSON.stringify([{ placeId: "Q-new" }, { text: "say hi" }, { placeId: "Q-old" }, { placeId: "Q-new" }, { placeId: "<bad>" }]));
    localStorage.setItem("larry.places", JSON.stringify([{ placeId: "Q-visited" }]));
    expect(recentPlaceIds()).toEqual(["Q-new", "Q-old"]);
    expect(recentPlacesField()).toEqual({ recentPlaces: ["Q-new", "Q-old"] });
  });
});
