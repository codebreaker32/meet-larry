import type { Page } from "@playwright/test";
import type { FirstStep } from "../src/lib/types";
import { expect, test } from "./fixtures";
import { SAM, seedStorage } from "./helpers";

// Gate G2 (final-build-plan section 5): the four Stage 1 journeys end to end, on desktop and
// mobile. Model, Qloo and Fingerprint answers are mocked at the HTTP boundary; check-ins and
// accounts run against the real routes (fake e2e venue, fake e2e sign-in, in-memory database).

/* ---------------------------------------------------------------- 1. card, mood and age */

test("G2: make a card with mood and age, and the one location ask comes right after saving", async ({ page }) => {
  await page.goto("/create");
  for (const title of ["Spirited Away", "Interstellar", "Your Name."]) await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByLabel("Your first name").fill("Alex");
  await page.getByRole("radiogroup", { name: "How old are you?" }).getByRole("radio", { name: "25–34" }).click();
  await page.getByRole("group", { name: /How are you feeling today/ }).getByRole("button", { name: "Chill" }).click();
  await page.getByRole("button", { name: "Save my card" }).filter({ visible: true }).first().click();
  // D24: the one location ask, right after saving.
  await page.getByTestId("location-ask").getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(/\/card$/);
  expect(await page.evaluate(() => [localStorage.getItem("larry.ageBucket"), localStorage.getItem("larry.mood")])).toEqual(['"25-34"', '"chill"']);

  // The Fingerprint (count, Ask-me line, share image after a real win) lives on /me now: fingerprint.spec.ts.
});

/* ---------------------------------------------------------------- 3. check-in, device and account */

const VENUE = { latitude: 51.5072, longitude: -0.1276, accuracy: 20 };
const PLACE_ID = "E2E00000-0000-4000-8000-00000000C1A0";
const PLACE = "Dice and Tea Board Game Cafe";
const planned = (): FirstStep =>
  ({ id: "plan1", kind: "go", text: `Go to ${PLACE}, Sat 11am.`, createdAt: Date.now() - 60_000, done: false, placeId: PLACE_ID, placeName: PLACE, vibe: "calm", guess: 3 }) as FirstStep;

/** Real arrive and leave (fake venue); Leave runs 25 minutes later on the server clock. */
async function realCheckins(page: Page) {
  await page.route("**/api/checkins/{arrive,leave}", async (route) => {
    const extra: Record<string, string> = { "x-e2e-fake-qloo": "1" };
    if (route.request().url().endsWith("/leave")) extra["x-e2e-now-offset-ms"] = String(25 * 60_000);
    await route.continue({ headers: { ...route.request().headers(), ...extra } });
  });
  await page.route("**/api/checkins/playback", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ line: "A new Rookie, and the dice approve.", plain: "You went. It counts.", source: "model" }) }),
  );
}

async function arriveAndLeave(page: Page) {
  await page.goto("/steps");
  await page.getByRole("button", { name: `I'm here: ${PLACE}` }).click();
  await page.getByRole("region", { name: `Check in at ${PLACE}` }).getByRole("button", { name: "I'm here" }).click();
  await page.getByRole("region", { name: `You're at ${PLACE}. Enjoy it.` }).getByRole("button", { name: "I'm heading off" }).click();
  const counted = page.getByRole("region", { name: `Counted. Your first visit at ${PLACE}.` });
  await expect(counted.getByText(/^Rookie\b/).first()).toBeVisible();
  // Reality faces, then Larry's line.
  await counted.getByRole("radio", { name: "Good" }).click();
  await counted.getByRole("button", { name: "Done" }).click();
  await expect(counted).toContainText("Larry: A new Rookie, and the dice approve.");
  return counted;
}

test.describe("G2 check-in", () => {
  test.use({ geolocation: VENUE, permissions: ["geolocation"] });

  test("device only: simulated arrive, leave 20+ minutes later, reality faces, Rookie (Glory stays on the phone)", async ({ page }) => {
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    await realCheckins(page);
    const counted = await arriveAndLeave(page);
    await expect(counted).toContainText("You're a Rookie here now.");
    expect(await page.evaluate(() => localStorage.getItem("larry.glory"))).toBe("10");
  });

  test("signed in: the same visit adds +10 Glory to the account on the server", async ({ page }) => {
    // A real account on the in-memory database, signed in with the fake e2e token.
    const uid = `g2-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
    const auth = { authorization: `Bearer e2e:${uid}` };
    const { username } = (await (await page.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
    const made = await page.request.post("/api/account", { data: { name: "Sam", username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
    expect(made.status(), await made.text()).toBeLessThan(300);
    await page.addInitScript((id) => localStorage.setItem("larry.e2e.uid", id), uid);
    await seedStorage(page, { profile: SAM, steps: [planned()] });
    await realCheckins(page);
    const counted = await arriveAndLeave(page);
    await expect(counted).toContainText(`+10 Glory for your visit to ${PLACE}.`);
    const account = await (await page.request.get("/api/account", { headers: auth })).json();
    expect(account.glory).toBe(10);
    // The account's range came down to the phone (never the date of birth).
    expect(await page.evaluate(() => localStorage.getItem("larry.ageBucket"))).toBe('"25-34"');
    await page.request.delete("/api/account", { headers: auth });
  });
});

/* ---------------------------------------------------------------- 4. accounts */

test("G2: sign in with a test number, sign up, /me shows the username, delete the account", async ({ page }) => {
  // Location already answered on this phone, so sign-in goes straight on.
  await page.addInitScript(() => localStorage.setItem("larry.location.choice", "off"));
  await page.goto("/signin?next=%2Fme");
  await page.getByLabel("Your phone number").fill(`+9198${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("The 6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signup/);
  await page.getByRole("button", { name: "Sounds good" }).click();
  await page.getByLabel("Your name").fill("Sam");
  await page.getByRole("button", { name: "Next" }).click();
  const nameBox = page.locator("p[aria-live=polite]");
  await expect(nameBox).toHaveText(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
  const username = (await nameBox.textContent())!;
  await page.getByRole("button", { name: "Use this name" }).click();
  await page.getByLabel("Day").selectOption("2");
  await page.getByLabel("Month").selectOption({ label: "March" });
  await page.getByLabel("Year").selectOption("1994");
  await page.getByRole("button", { name: "Make my account" }).click();
  await expect(page.getByText(`Welcome, ${username}. You're in.`)).toBeVisible();

  await page.goto("/me");
  const section = page.locator("section#account");
  await expect(section).toContainText(`Signed in as ${username}.`);
  // D12: off by default.
  await expect(section.getByRole("switch", { name: /Show me on place leaderboards/ })).toHaveAttribute("aria-checked", "false");
  await section.getByRole("button", { name: "Delete my account" }).click();
  await page.getByRole("dialog", { name: "Delete your account?" }).getByRole("button", { name: "Delete it all" }).click();
  await expect(section.getByRole("link", { name: "Sign in with your phone" })).toBeVisible();
});
