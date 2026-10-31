import type { Page } from "@playwright/test";
import { CAFE, FRIEND_PROFILE, mockContracts, OWNER_PROFILE, PODIUM, STRANGER_PROFILE, expect, test } from "./fixtures";

// Profiles and badges (2G). The people API is mocked at the HTTP boundary with the 0D contract
// answers, so this spec checks what each viewer is shown, not 2B's server. Signed-in pages use the
// fake e2e sign-in (NEXT_PUBLIC_E2E=1): a uid in localStorage, no SMS.

const signedIn = async (page: Page) => {
  await page.addInitScript(() => localStorage.setItem("larry.e2e.uid", "e2e-user-1"));
};

test("a stranger sees the username and title counts only: no venue, Glory or stage anywhere", async ({ page }) => {
  await mockContracts(page, { account: null, profile: { ...STRANGER_PROFILE, publicTitles: [{ title: "final-boss", places: 2 }, { title: "shogun", places: 1 }] } });
  await page.goto("/profile/QuietOtter42");
  await expect(page.getByRole("heading", { level: 1, name: "QuietOtter42" })).toBeVisible();
  await expect(page.getByText("at 2 places")).toBeVisible();
  await expect(page.getByText("at 1 place", { exact: true })).toBeVisible();
  const text = (await page.locator("main").textContent()) ?? "";
  expect(text).not.toContain(CAFE.placeName);
  expect(text).not.toMatch(/u\/|Glory|Rookie|Regular|Veteran|Elite|Legend/);
  // Never indexed.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // The badge meaning opens in a sheet.
  await page.getByRole("button", { name: /Final Boss.*What does this mean/ }).click();
  await expect(page.getByRole("dialog", { name: "Final Boss" })).toContainText("Most visits here of anyone on Larry.");
});

test("a friend who shares sees the venues; Unfriend is one tap and silent", async ({ page }) => {
  await signedIn(page);
  await mockContracts(page, { profile: { ...FRIEND_PROFILE, username: "BraveHeron31", displayName: "Priya" } });
  await page.goto("/profile/BraveHeron31");
  await expect(page.getByRole("heading", { level: 1, name: "BraveHeron31" })).toBeVisible();
  await expect(page.getByText(`at ${CAFE.placeName}`).first()).toBeVisible();
  await expect(page.locator("main").getByText("Party Leader", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Unfriend Priya" }).click();
  await expect(page.getByText("Done. You and Priya aren't friends any more.")).toBeVisible();
});

test("/u/<name> lands on /profile/<name>; Block from a friend's profile is one sheet and leaves them gone", async ({ page }) => {
  await signedIn(page);
  await mockContracts(page, { profile: { ...FRIEND_PROFILE, username: "BraveHeron31", displayName: "Priya" } });
  let posted: unknown = null;
  await page.route("**/api/friends", async (r) => {
    if (r.request().method() === "POST") {
      posted = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return r.fallback();
  });
  await page.goto("/u/BraveHeron31");
  await expect(page).toHaveURL(/\/profile\/BraveHeron31$/);
  await page.getByRole("button", { name: "Block or report Priya" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Block", exact: true }).click();
  await sheet.getByRole("button", { name: "Block Priya" }).click();
  await expect(sheet).toContainText("Priya is blocked.");
  expect(posted).toEqual({ action: "block", username: "BraveHeron31" });
  await sheet.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("heading", { name: "This profile isn't available." })).toBeVisible();
});

test("an unknown or blocked name reads the same: not available", async ({ page }) => {
  await mockContracts(page, { account: null });
  await page.route("**/api/profile/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto("/profile/CalmWalrus12");
  await expect(page.getByRole("heading", { name: "This profile isn't available." })).toBeVisible();
});

test("the place page shows the top 3 under made-up names, marks nobody's profile, and ends at a door", async ({ page }) => {
  await mockContracts(page, { account: null, podium: PODIUM });
  await page.goto(`/place/${CAFE.placeId}?name=${encodeURIComponent(CAFE.placeName)}`);
  await expect(page.getByRole("heading", { level: 1, name: CAFE.placeName })).toBeVisible();
  const podium = page.locator("[data-podium]");
  await expect(podium.locator("[data-podium-row]")).toHaveCount(3);
  await expect(podium).toContainText("MossyLantern7");
  await expect(podium).toContainText(`at ${CAFE.placeName}`);
  // No profile links and no visit numbers on the podium.
  await expect(podium.locator("a")).toHaveCount(0);
  expect((await podium.textContent()) ?? "").not.toMatch(/\d+\s*visits?|u\//);
  await expect(page.locator("[data-door]")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("a closed podium says so warmly", async ({ page }) => {
  await mockContracts(page, { account: null, podium: { ...PODIUM, open: false, participants: 1, entries: [] } });
  await page.goto(`/place/${CAFE.placeId}?name=${encodeURIComponent(CAFE.placeName)}`);
  await expect(page.locator("[data-podium-closed]")).toContainText("opens once a few more regulars count here");
});

test("the owner's /me shows Glory, all 13 badges, titles with place names, friends with Unfriend, and the sharing switch", async ({ page }) => {
  await signedIn(page);
  await mockContracts(page, { profile: OWNER_PROFILE });
  await page.goto("/me");
  const profile = page.locator("#profile");
  await expect(profile.getByRole("heading", { name: "QuietOtter42" })).toBeVisible();
  await expect(profile.getByText("30", { exact: true })).toBeVisible();
  await expect(profile.getByRole("list", { name: "Your badges" }).getByRole("listitem")).toHaveCount(13);
  await expect(profile).toContainText("MossyLantern7");
  await expect(profile).toContainText("Regular is one visit away at Dice and Tea Board Game Cafe.");
  await expect(profile).toContainText("Only you see this.");

  const friends = page.locator("#friends");
  await expect(friends.getByRole("switch", { name: /Show my check-ins to friends/ })).toHaveAttribute("aria-checked", "false");
  await friends.getByRole("switch", { name: /Show my check-ins to friends/ }).click();
  await expect(friends.getByText("Done. Friends who share too can see which places your titles are at.")).toBeVisible();
  await expect(friends.locator("[data-friend-row]")).toHaveCount(1);
  await friends.getByRole("button", { name: "Unfriend Priya" }).click();
  await expect(friends.getByText("Done. You and Priya aren't friends any more.")).toBeVisible();
  await expect(friends.locator("[data-friend-row]")).toHaveCount(0);
  // Fingerprint and the account panel are still on the page.
  await expect(page.locator("#account")).toBeVisible();
});

test("device only: /me shows private stages and Glory from this phone, no username, no friends", async ({ page }) => {
  await mockContracts(page, { account: null });
  await page.addInitScript(
    ([place]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(
        "larry.places",
        JSON.stringify([{ placeId: place.placeId, placeName: place.placeName, visits: 3, weeksBits: "111", totalWeeks: 3, lastIsoWeek: "2026-W44", stage: "regular", spotWeeks: 3 }]),
      );
      localStorage.setItem("larry.glory", "30");
    },
    [CAFE] as const,
  );
  await page.goto("/me");
  const profile = page.locator("#profile");
  await expect(profile.getByRole("heading", { name: "Your progress" })).toBeVisible();
  await expect(profile).toContainText(CAFE.placeName);
  await expect(profile).toContainText("Regular");
  await expect(page.locator("#friends")).toHaveCount(0);
});
