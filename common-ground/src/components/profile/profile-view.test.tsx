// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { FriendProfile, OwnerProfile, StrangerProfile } from "@/lib/types/profile";

// Dynamic imports are slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace() {}, push() {} }) }));

function stubMatchMedia(reduce = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

beforeEach(() => stubMatchMedia());
afterEach(() => cleanup());

const VENUES = ["Café Condi", "Dice and Tea Board Game Cafe", "Title Waves Books"];

describe("profile views (one profile, three audiences)", () => {
  it("a stranger sees the username and title counts in words, never a venue, Glory or stage", async () => {
    const { ProfileView } = await import("./profile-view");
    // Even if a server bug smuggled venue data in, the stranger view never reads it.
    const smuggled = {
      viewer: "stranger",
      username: "QuietOtter42",
      publicTitles: [
        { title: "final-boss", places: 2 },
        { title: "shogun", places: 1 },
        { title: "guildmaster", places: 0 },
      ],
      places: [{ venue: { placeId: "p1", placeName: VENUES[0] } }],
      glory: 312,
    } as unknown as StrangerProfile;
    const { container } = render(<ProfileView profile={smuggled} />);
    expect(screen.getByRole("heading", { level: 1, name: "QuietOtter42" })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/u\//);
    expect(text).toContain("Final Boss");
    expect(text).toContain("at 2 places");
    expect(text).toContain("at 1 place");
    // A zero count is left out, never "at 0 places".
    expect(text).not.toContain("Guildmaster");
    for (const v of VENUES) expect(text).not.toContain(v);
    expect(text).not.toMatch(/Glory|Rookie|Regular|Veteran|Elite|Legend/);
  });

  it("a friend who doesn't share shows a neutral line and no venues; Unfriend is one tap", async () => {
    const { ProfileView } = await import("./profile-view");
    const p: FriendProfile = {
      viewer: "friend",
      username: "MossyLantern7",
      displayName: "Priya",
      publicTitles: [],
      friendTitles: [],
      timesMet: 0,
      sharing: false,
    };
    const onUnfriend = vi.fn();
    const { container } = render(<ProfileView profile={p} onUnfriend={onUnfriend} />);
    expect(container.textContent).toContain("Priya keeps their places to themselves for now.");
    screen.getByRole("button", { name: /Unfriend Priya/ }).click();
    expect(onUnfriend).toHaveBeenCalledTimes(1);
  });

  it("a friend who shares shows which venue each title is at, plus Glory", async () => {
    const { ProfileView } = await import("./profile-view");
    const p: FriendProfile = {
      viewer: "friend",
      username: "MossyLantern7",
      displayName: "Priya",
      glory: 120,
      publicTitles: [{ title: "guildmaster", venue: { placeId: "p1", placeName: VENUES[0] } }],
      friendTitles: [{ title: "party-leader", venue: { placeId: "p2", placeName: VENUES[1] } }],
      timesMet: 0,
      sharing: true,
    };
    const { container } = render(<ProfileView profile={p} />);
    const text = container.textContent ?? "";
    expect(text).toContain(`at ${VENUES[0]}`);
    expect(text).toContain(`at ${VENUES[1]}`);
    expect(text).toContain("Party Leader");
    expect(text).toContain("120 Glory");
    // Private stages never reach a friend.
    expect(text).not.toMatch(/Rookie|Regular|Veteran|Elite|Legend/);
  });

  it("the owner sees everything: Glory, the near-title line, all 13 badges, aliases and private places", async () => {
    const { ProfileView } = await import("./profile-view");
    const p: OwnerProfile = {
      viewer: "owner",
      username: "QuietOtter42",
      displayName: "Sam",
      glory: 45,
      places: [
        { venue: { placeId: "p1", placeName: VENUES[1] }, stage: "regular", visits: 4, weeks: 2, nextStage: { stage: "veteran", visitsAway: 2 } },
      ],
      publicTitles: [{ title: "final-boss", venue: { placeId: "p1", placeName: VENUES[1] }, alias: "BraveHeron9" }],
      friendTitles: [],
      sharingWithFriends: false,
      showOnLeaderboards: true,
      rivalry: "1 visit until you take Party Leader at Title Waves Books.",
    };
    const { container } = render(<ProfileView profile={p} />);
    const text = container.textContent ?? "";
    expect(text).toContain("45 Glory");
    expect(text).toContain("Veteran is 2 visits away at Dice and Tea Board Game Cafe.");
    expect(text).toContain("1 visit until you take Party Leader");
    expect(text).toContain("BraveHeron9");
    expect(text).toContain("Only you see this.");
    const shelf = screen.getByRole("list", { name: "Your badges" });
    expect(within(shelf).getAllByRole("listitem")).toHaveLength(13);
    // Earned: Glory, Rookie, Regular, Final Boss. Not yet: the rest.
    expect(container.querySelectorAll('svg[data-earned="yes"][data-badge]').length).toBeGreaterThanOrEqual(4);
    expect(within(shelf).getAllByText(", not yet")).toHaveLength(9);
  });

  it("a brand-new owner gets one door, never '0 Glory'", async () => {
    const { ProfileView } = await import("./profile-view");
    const p: OwnerProfile = {
      viewer: "owner",
      username: "QuietOtter42",
      displayName: "Sam",
      glory: 0,
      places: [],
      publicTitles: [],
      friendTitles: [],
      sharingWithFriends: false,
      showOnLeaderboards: false,
    };
    const { container } = render(<ProfileView profile={p} />);
    expect(container.textContent).toContain("Your first title is one visit away.");
    expect(container.textContent).not.toMatch(/\b0 Glory/);
    expect(screen.getByRole("link", { name: "See my next move" })).toBeTruthy();
  });
});

describe("helpers", () => {
  it("nearTitleLine shows only when the next stage is close", async () => {
    const { nearTitleLine } = await import("./profile-view");
    const v = { placeId: "p", placeName: "Café Condi" };
    expect(nearTitleLine([{ venue: v, stage: "rookie", visits: 1, weeks: 1, nextStage: { stage: "regular", visitsAway: 2 } }])).toBe(
      "Regular is 2 visits away at Café Condi.",
    );
    expect(nearTitleLine([{ venue: v, stage: "veteran", visits: 6, weeks: 3, nextStage: { stage: "elite", visitsAway: 4 } }])).toBeNull();
    expect(nearTitleLine([])).toBeNull();
  });

  it("profile links use /profile/, since usernames carry no u/", async () => {
    const { profileHref } = await import("./profile-view");
    expect(profileHref("QuietOtter42")).toBe("/profile/QuietOtter42");
  });

  it("placesFromCounters keeps verified places only, busiest first, with the next stage", async () => {
    const { placesFromCounters } = await import("./owner-section");
    const out = placesFromCounters([
      { placeId: "a", placeName: "A", visits: 0, stage: null, spotWeeks: 0 },
      { placeId: "b", placeName: "B", visits: 3, stage: "regular", spotWeeks: 2 },
      { placeId: "c", placeName: "C", visits: 20, stage: "legend", spotWeeks: 9 },
    ]);
    expect(out.map((p) => p.venue.placeId)).toEqual(["c", "b"]);
    expect(out[0].nextStage).toBeUndefined();
    expect(out[1].nextStage).toEqual({ stage: "veteran", visitsAway: 3 });
  });
});

describe("friend safety", () => {
  it("a friend's profile has Block or report beside Unfriend, and a report posts the friend's username with the reason", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.doMock("@/lib/firebase/client", () => ({
      authFetch: async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response("{}", { status: 200 });
      },
    }));
    vi.resetModules();
    const { friendAction, FRIEND_REPORT_TEXT } = await import("./friend-safety");
    expect(await friendAction("BraveHeron31", "report", "unsafe")).toBe(true);
    expect(calls[0]).toEqual({ url: "/api/friends", body: { action: "report", username: "BraveHeron31", reason: "unsafe" } });
    expect(Object.keys(FRIEND_REPORT_TEXT).sort()).toEqual(["other", "spam", "underage", "unkind", "unsafe"]);

    const { ProfileView } = await import("./profile-view");
    const friend: FriendProfile = {
      viewer: "friend",
      username: "BraveHeron31",
      displayName: "Priya",
      sharing: false,
      publicTitles: [],
      friendTitles: [],
    } as unknown as FriendProfile;
    render(<ProfileView profile={friend} onUnfriend={() => {}} />);
    expect(screen.getByRole("button", { name: "Unfriend Priya" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block or report Priya" })).toBeTruthy();
    vi.doUnmock("@/lib/firebase/client");
  });
});
