import type { Page } from "@playwright/test";
import { expect, mockContracts, test } from "./fixtures";

// Larry's next move on home: a popup (bottom sheet on phones, a centred card on desktop) for a
// SIGNED-IN person with a taste card, at most once a day by itself, and a "Larry's next move" pill
// that reopens it. Visitors and device-only people never see it. Signed in with the fake e2e sign-in
// (a uid in localStorage) and the 0D account mocks. No model or Qloo call: /api/witty and
// /api/matchday answer 404 unless a test says otherwise, so Larry's fixed lines show.

const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" };
const MI = { id: "E2E0TEAM-0000-4000-8000-00000000000A", name: "Mumbai Indians", domain: "sports_team" };
const persona = (likes: object[] = [STARDEW]) =>
  JSON.stringify({ version: 1, name: "Sam", likes, dislikes: [], notes: [], placeVibe: "calm" });
const PLACE_ID = "E2E00000-0000-4000-8000-0000000000C1";

function thisIsoWeek(d = new Date()): string {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  const th = new Date(day + (3 - dow) * 864e5);
  const jan1 = Date.UTC(th.getUTCFullYear(), 0, 1);
  return `${th.getUTCFullYear()}-W${String(Math.floor((th.getTime() - jan1) / 864e5 / 7) + 1).padStart(2, "0")}`;
}
const counters = (visits: number) =>
  JSON.stringify([
    { placeId: PLACE_ID, placeName: "Dice and Tea", visits, weeksBits: "1", totalWeeks: 1, lastIsoWeek: thisIsoWeek(), stage: "rookie", spotWeeks: 1 },
  ]);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const planStep = (when: string) =>
  JSON.stringify([
    {
      id: "s1",
      kind: "go",
      text: "Go to Dice and Tea.",
      createdAt: Date.now() - 1000,
      done: false,
      placeId: PLACE_ID,
      placeName: "Dice and Tea",
      when,
      opener: "Have you ever tried Stardew Valley?",
      withPerson: "Priya",
    },
  ]);

const UID = { "larry.e2e.uid": "e2e-user-1" };
const SHOWN_KEY = "larry.nextmove.shownOn";

/** Seeds the device once per test, signs in (unless told not to) and opens home. */
async function home(page: Page, seed: Record<string, string>, opts: { signedIn?: boolean; witty?: object; matchday?: object } = {}) {
  if (opts.signedIn !== false) await mockContracts(page);
  await page.route("**/api/witty", (r) => (opts.witty ? r.fulfill({ json: opts.witty }) : r.fulfill({ status: 404, body: "{}" })));
  await page.route("**/api/matchday**", (r) => (opts.matchday ? r.fulfill({ json: opts.matchday }) : r.fulfill({ status: 404, body: "{}" })));
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("e2e.seeded")) return;
    sessionStorage.setItem("e2e.seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, opts.signedIn === false ? seed : { ...UID, ...seed });
  await page.goto("/");
  return page.getByTestId("next-move");
}

const popup = (page: Page) => page.getByRole("dialog", { name: "Larry's next move" });
const pill = (page: Page) => page.getByRole("button", { name: "Larry's next move" });

/** After a reload the popup has already opened today, so the pill brings it back. */
async function reopen(page: Page) {
  await page.reload();
  await pill(page).click();
  await expect(popup(page)).toBeVisible();
  return page.getByTestId("next-move");
}

const ADULT = { "larry.ageBucket": JSON.stringify("25-34") };

test("signed in with a card: the popup opens by itself once a day, over the normal home buttons", async ({ page }) => {
  const card = await home(page, { "larry.persona": persona(), ...ADULT });
  await expect(popup(page)).toBeVisible();
  await expect(card.getByRole("heading", { name: "See your Taste Fingerprint" })).toBeVisible();
  await expect(card.getByText("Larry (AI pal)")).toBeVisible();
  // Help is inside the popup, so it is never covered.
  await expect(popup(page).getByRole("button", { name: "Need help now?" })).toBeVisible();

  // Escape closes it; underneath is the signed-in home, not the visitor hero.
  await page.keyboard.press("Escape");
  await expect(popup(page)).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Hi, Sam." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Talk to someone, not something." })).toHaveCount(0);
  const main = page.getByRole("main");
  for (const [name, href] of [
    ["Start a group", "/group/new"],
    ["Your groups", "/group"],
    ["Talk taste with Larry", "/larry"],
    ["Pick a pal", "/practice"],
  ]) {
    const link = main.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }

  // Same day: it stays shut; the pill reopens it and focus comes back to the pill.
  await page.reload();
  await expect(pill(page)).toBeVisible();
  await expect(popup(page)).toBeHidden();
  expect((await pill(page).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await pill(page).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("button", { name: "Close" }).click();
  await expect(popup(page)).toBeHidden();
  await expect(pill(page)).toBeFocused();

  // A new day: it opens by itself again.
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify("2000-01-01")), SHOWN_KEY);
  await page.reload();
  await expect(popup(page)).toBeVisible();
});

test("visitors and device-only people never see the popup or the pill", async ({ page }) => {
  await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", ...ADULT }, { signedIn: false });
  await expect(page.getByRole("heading", { level: 1, name: "Talk to someone, not something." })).toBeVisible();
  await expect(page.getByTestId("next-move-pill")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("next-move")).toHaveCount(0);
});

test("signed in without a card: no popup, and Make my taste card comes first", async ({ page }) => {
  await home(page, ADULT);
  await expect(page.getByRole("heading", { level: 1, name: "Hi, Sam." })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Make my taste card" })).toBeVisible();
  await expect(page.getByTestId("next-move-pill")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("step 3 for adults: start a group and show the QR, with Pick a pal and Open to meet", async ({ page }) => {
  const card = await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", ...ADULT });
  await expect(card.getByRole("heading", { name: "Start a group and show the QR" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Start a group" })).toHaveAttribute("href", "/group/new");
  await expect(card.getByRole("link", { name: "Pick a pal first" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Open to meet" })).toBeVisible();
  for (const link of await card.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  for (const button of await popup(page).getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
});

test("Something smaller swaps in a smaller step at once", async ({ page }) => {
  const card = await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", ...ADULT });
  await card.getByRole("button", { name: "Something smaller" }).click();
  const heading = card.getByRole("heading", { name: "Was that step too big?" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(card.getByRole("link", { name: "Find a calm place" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Something smaller" })).toHaveCount(0);
});

test("Not now twice: Larry offers a smaller step", async ({ page }) => {
  const card = await home(page, {
    "larry.persona": persona(),
    "larry.fingerprint.seen": "true",
    "larry.moves.ignored": JSON.stringify(["second-person"]),
    ...ADULT,
  });
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(popup(page)).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "something else next time" })).toBeAttached();
  const again = await reopen(page);
  await expect(again.getByRole("heading", { name: "Was that step too big?" })).toBeVisible();
});

test("step 5: a plan on another day shows its opener; step 6: today's plan asks for a check-in with progress", async ({ page }) => {
  const other = DAYS[(new Date().getDay() + 2) % 7];
  let card = await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", "cg.steps": planStep(`${other} 11am`), ...ADULT });
  await expect(card.getByRole("heading", { name: `Dice and Tea, ${other} 11am` })).toBeVisible();
  await expect(card.getByTestId("next-move-why")).toContainText("Have you ever tried Stardew Valley?");
  // A plan already made is never "smaller".
  await expect(card.getByRole("button", { name: "Something smaller" })).toHaveCount(0);

  await page.evaluate(
    ([steps, c]) => {
      localStorage.setItem("cg.steps", steps);
      localStorage.setItem("larry.places", c);
    },
    [planStep(`Today 4pm`), counters(1)] as const,
  );
  card = await reopen(page);
  await expect(card.getByRole("heading", { name: "Check in at Dice and Tea" })).toBeVisible();
  await expect(card.getByText("Regular is 2 visits away.")).toBeVisible();
  await expect(card.getByRole("link", { name: "Check in" })).toHaveAttribute("href", "/steps");
});

test("step 7: this month's quest, completed only by verified check-ins", async ({ page }) => {
  const card = await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", "cg.steps": "[]", "larry.places": counters(2), "larry.groups.met": "1", ...ADULT });
  const quest = card.getByTestId("quest-card");
  await expect(quest.getByText("This month's quest")).toBeVisible();
  await expect(card.getByRole("heading", { name: "The Dice and Tea Round" })).toBeVisible();
  await expect(quest.getByText("Go back to Dice and Tea 2 times this month.")).toBeVisible();
  await expect(quest.getByText("0 of 2 done")).toBeVisible();
  await expect(card).not.toContainText(/days left|expires|streak/i);

  // An unverified "Visited" does nothing; a verified visit moves it to 1 of 2.
  await page.evaluate((c) => {
    const list = JSON.parse(c);
    list[0].unverified = 1;
    localStorage.setItem("larry.places", JSON.stringify(list));
  }, counters(2));
  await expect((await reopen(page)).getByTestId("quest-card").getByText("0 of 2 done")).toBeVisible();
  await page.evaluate((c) => localStorage.setItem("larry.places", c), counters(3));
  await expect((await reopen(page)).getByTestId("quest-card").getByText("1 of 2 done")).toBeVisible();
});

test("step 7: a verified Match Day fixture beats the quest; Larry's fresh line replaces the fixed one", async ({ page }) => {
  const card = await home(
    page,
    { "larry.persona": persona([STARDEW, MI]), "larry.fingerprint.seen": "true", "cg.steps": "[]", "larry.places": counters(2), "larry.groups.met": "1", ...ADULT },
    {
      matchday: { matchDays: [{ team: "Mumbai Indians", league: "IPL", fixture: { teams: "MI v CSK", when: "Sun 7:30pm" }, source: "IPL schedule" }] },
      witty: { line: "Mumbai Indians on a big screen, a calm table, and a game that does the talking.", plain: "Watch Mumbai Indians at a calm place.", source: "model" },
    },
  );
  await expect(card.getByRole("heading", { name: "MI v CSK, Sun 7:30pm" })).toBeVisible();
  await expect(card.getByTestId("next-move-why")).toHaveText("Mumbai Indians on a big screen, a calm table, and a game that does the talking.");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a bottom sheet with no motion under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await home(page, { "larry.persona": persona(), "larry.fingerprint.seen": "true", ...ADULT });
    const sheet = popup(page);
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(Math.round(box.width)).toBe(390);
    const dur = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) || 0);
    expect(dur).toBeLessThan(0.01);

    // Need help now? opens on top of the sheet, and closing it comes back to the sheet.
    await sheet.getByRole("button", { name: "Need help now?" }).click();
    const help = page.getByRole("dialog", { name: "Need help now?" });
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(sheet).toBeVisible();
  });
});
