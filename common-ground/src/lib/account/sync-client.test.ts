// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../types/storage-keys";
import { buildSyncBlob, restoreFromAccount, syncAccount } from "./sync-client";

const counter = {
  placeId: "p1",
  placeName: "Dice and Tea",
  visits: 4,
  weeksBits: "1011",
  totalWeeks: 4,
  lastIsoWeek: "2026-W44",
  stage: "regular",
  spotWeeks: 3,
  unverified: 1,
};

beforeEach(() => localStorage.clear());

describe("account sync (D11: counts, not a diary)", () => {
  it("sends folded counts only: no weeks bitset, week number or any time field", () => {
    localStorage.setItem(STORAGE_KEYS.placeCounters, JSON.stringify([counter]));
    localStorage.setItem(
      STORAGE_KEYS.steps,
      JSON.stringify([{ id: "s1", kind: "go", text: "Go to Dice and Tea", createdAt: 1, done: true, doneAt: 1730000000000, checkedAt: 1730000000000 }]),
    );
    const blob = buildSyncBlob();
    expect(blob.placeCounters).toEqual([{ placeId: "p1", placeName: "Dice and Tea", visits: 4, stage: "regular", spotWeeks: 3 }]);
    const text = JSON.stringify(blob);
    for (const banned of ["weeksBits", "lastIsoWeek", "totalWeeks", "doneAt", "checkedAt", "arrive", "leave", "2026-W44"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("fills an empty phone from the account, and never overwrites what the phone has", () => {
    const restored = restoreFromAccount({ persona: null, steps: [], placeCounters: [{ placeId: "p1", placeName: "Dice and Tea", visits: 4, stage: "regular", spotWeeks: 3 }] });
    expect(restored).toEqual(["places"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.placeCounters)!)[0]).toMatchObject({ visits: 4, weeksBits: "" });
    expect(restoreFromAccount({ persona: null, steps: [], placeCounters: [{ placeId: "p2", placeName: "X", visits: 1, stage: "rookie", spotWeeks: 1 }] })).toEqual([]);
  });

  it("runs at most once a day unless forced", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("{}", { status: 200 }) : Response.json({ persona: null, steps: [], placeCounters: [] }),
    );
    expect(await syncAccount(fetcher, { now: 1_000_000_000 })).toBe("synced");
    expect(await syncAccount(fetcher, { now: 1_000_000_000 + 60_000 })).toBe("skipped");
    expect(await syncAccount(fetcher, { now: 1_000_000_000 + 60_000, force: true })).toBe("synced");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
