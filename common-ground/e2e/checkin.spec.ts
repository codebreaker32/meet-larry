import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { FirstStep } from "../src/lib/types";
import { SAM, seedStorage } from "./helpers";

// Check-in v2 against the real routes. The dev-only x-e2e-fake-qloo header makes any place id the
// fake café at the e2e venue location (51.5072, -0.1276) with unknown hours, and
// x-e2e-now-offset-ms moves the server's clock on, so "20 minutes later" needs no waiting.
// Larry's playback line is mocked here so no test can reach a model.

const VENUE = { latitude: 51.5072, longitude: -0.1276, accuracy: 20 };
const PLACE_ID = "E2E00000-0000-4000-8000-00000000C1A0";
const PLACE = "Dice and Tea Board Game Cafe";
const LARRY_LINE = "Dice and Tea has a new Rookie, and the board games approve.";

const planned = (): FirstStep =>
  ({
    id: "plan1",
    kind: "go",
    text: `Go to ${PLACE}, Sat 11am.`,
    createdAt: Date.now() - 60_000,
    done: false,
    placeId: PLACE_ID,
    placeName: PLACE,
    vibe: "calm",
    opener: "Have you played Stardew Valley?",
    planB: "If it's too busy, I'll come back on a weekday.",
    guess: 2,
  }) as FirstStep;

/** Real check-in routes with the fake venue; `later` moves the server clock on for Leave. */
async function realCheckins(page: Page, opts: { later?: number } = {}) {
  const sent: string[] = [];
  await page.route("**/api/checkins/{arrive,leave}", async (route) => {
    sent.push(route.request().postData() ?? "");
    const extra: Record<string, string> = { "x-e2e-fake-qloo": "1" };
    if (opts.later && route.request().url().endsWith("/leave")) extra["x-e2e-now-offset-ms"] = String(opts.later);
    await route.continue({ headers: { ...route.request().headers(), ...extra } });
  });
  await page.route("**/api/checkins/playback", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ line: LARRY_LINE, plain: "You went. It counts.", source: "model" }) }),
  );
  return sent;
}

test.describe("check-in v2", () => {
  test.use({ geolocation: VENUE, permissions: ["geolocation"] });

  test("arrive at the place, leave too soon, then a counted visit with Glory, Guess vs Reality and Larry's line", async ({ page }) => {
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    // An adult range: Open to meet is hidden for 13-17s and unknown ages (D17).
    await page.addInitScript(() => localStorage.setItem("larry.ageBucket", JSON.stringify("25-34")));
    const sent = await realCheckins(page, { later: 25 * 60_000 });
    await page.goto("/steps");

    await page.getByRole("button", { name: `I'm here: ${PLACE}` }).click();
    const sheet = page.getByRole("region", { name: `Check in at ${PLACE}` });
    await expect(sheet).toContainText("Visits count after 20 minutes.");
    await sheet.getByRole("button", { name: "I'm here" }).click();

    // While there: a calm card, the line to say, plan B, the honour tap. No timer.
    const here = page.getByRole("region", { name: `You're at ${PLACE}. Enjoy it.` });
    await expect(here.getByRole("heading")).toBeFocused();
    await expect(here).toContainText("Have you played Stardew Valley?");
    await expect(here).toContainText("If it's too busy, I'll come back on a weekday.");
    await expect(here.getByRole("link", { name: "Open to meet here" })).toHaveAttribute("href", `/meet/${PLACE_ID}`);
    const visit = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.visit") ?? "null") as { visitToken: string; dwellMs: number } | null);
    expect(visit?.dwellMs).toBe(20 * 60_000);
    // The "I'm here" buttons go while a visit is open.
    await expect(page.getByRole("button", { name: `I'm here: ${PLACE}` })).toHaveCount(0);

    await here.getByRole("button", { name: "I said hi" }).click();
    await expect(here.getByRole("button", { name: "I said hi" })).toHaveAttribute("aria-pressed", "true");
    await here.getByRole("button", { name: "I'm heading off" }).click();

    const counted = page.getByRole("region", { name: `Counted. Your first visit at ${PLACE}.` });
    await expect(counted).toBeVisible();
    await expect(counted.getByText(/^Rookie\b/).first()).toBeVisible();
    await expect(counted).toContainText("You're a Rookie here now.");
    await expect(counted).toContainText(`+15 Glory for your visit to ${PLACE}.`);
    await expect(counted.getByText("15 Glory.", { exact: true })).toBeAttached();

    // How did it go? Better than the guess: the comparison shows, in words.
    await counted.getByRole("radio", { name: "Good" }).click();
    await counted.getByRole("button", { name: "Yes" }).click();
    await counted.getByRole("button", { name: "Done" }).click();
    await expect(counted.getByRole("status").filter({ hasText: "You guessed Not great. It was Good." })).toBeAttached();
    await expect(counted).toContainText(`Larry: ${LARRY_LINE}`);

    // Same place, same time next week comes first.
    await counted.getByRole("button", { name: "Same place, same time next week?" }).click();
    await expect(counted.getByRole("status").filter({ hasText: `Saved: ${PLACE}` })).toBeVisible();

    // Counts, not a diary: the open visit (token, arrive time) is gone; only counts stay.
    const stored = await page.evaluate(() => ({
      visit: localStorage.getItem("larry.visit"),
      places: JSON.parse(localStorage.getItem("larry.places") ?? "[]") as Record<string, unknown>[],
      glory: localStorage.getItem("larry.glory"),
    }));
    expect(stored.visit).toBeNull();
    expect(stored.glory).toBe("15");
    expect(stored.places).toHaveLength(1);
    expect(stored.places[0]).toMatchObject({ placeId: PLACE_ID, visits: 1, stage: "rookie", spotWeeks: 1 });
    expect(JSON.stringify(stored.places)).not.toMatch(/arrivedAt|visitToken|"at"/);

    // Your places: private, with the stage.
    const mine = page.getByRole("region", { name: "Your places" });
    await expect(mine).toContainText("Only you see this. We keep counts, not a diary.");
    await expect(mine).toContainText("1 visit counted.");

    // The requests carried a fix and a token, never a place name, persona or anything stored.
    expect(sent).toHaveLength(2);
    for (const body of sent) expect(body).not.toMatch(/Stardew|persona|Dice/);
  });

  test("leaving before 20 minutes: Still here keeps the visit; I've left keeps it as Visited", async ({ page }) => {
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    await realCheckins(page);
    await page.goto("/steps");
    await page.getByRole("button", { name: `I'm here: ${PLACE}` }).click();
    await page.getByRole("button", { name: "I'm here", exact: true }).click();
    await page.getByRole("button", { name: "I'm heading off" }).click();

    const quick = page.getByRole("region", { name: "That was quick!" });
    await expect(quick).toContainText("Visits count after 20 minutes. Still here? Tap Leave a bit later.");
    await quick.getByRole("button", { name: "Still here" }).click();
    await expect(page.getByRole("region", { name: `You're at ${PLACE}. Enjoy it.` })).toBeVisible();

    await page.getByRole("button", { name: "I'm heading off" }).click();
    await page.getByRole("region", { name: "That was quick!" }).getByRole("button", { name: "I've left" }).click();
    const went = page.getByRole("region", { name: "You still went" });
    await expect(went).toContainText("It's in Your places as Visited.");
    const places = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.places") ?? "[]") as Record<string, unknown>[]);
    expect(places[0]).toMatchObject({ visits: 0, stage: null, unverified: 1 });
    expect(await page.evaluate(() => localStorage.getItem("larry.glory"))).toBeNull();
  });
});

test.describe("check-in refusals", () => {
  test("from somewhere else: refused warmly, with Try again, and nothing is recorded", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.53, longitude: -0.1276, accuracy: 20 }); // ~2.5 km away
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    await realCheckins(page);
    await page.goto("/steps");
    await page.getByRole("button", { name: `I'm here: ${PLACE}` }).click();
    await page.getByRole("button", { name: "I'm here", exact: true }).click();
    const no = page.getByRole("region", { name: "Not yet" });
    await expect(no.getByRole("status")).toHaveText(`Looks like you're not at ${PLACE} yet. Check in when you get there!`);
    await expect(no.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(await page.evaluate(() => [localStorage.getItem("larry.visit"), localStorage.getItem("larry.places")])).toEqual([null, null]);
  });

  test("while the place is closed: refused warmly", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(VENUE);
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    await page.route("**/api/checkins/arrive", (r) =>
      r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ reason: "closed", error: "closed" }) }),
    );
    await page.goto("/steps");
    await page.getByRole("button", { name: `I'm here: ${PLACE}` }).click();
    await page.getByRole("button", { name: "I'm here", exact: true }).click();
    await expect(page.getByRole("region", { name: "Not yet" }).getByRole("status")).toHaveText(
      `Looks like ${PLACE} is closed right now. Check in when it's open!`,
    );
  });
});
