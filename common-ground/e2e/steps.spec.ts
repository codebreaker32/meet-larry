import { expect, test } from "./fixtures";
import type { FirstStep } from "../src/lib/types";
import { encodeStepLink } from "../src/lib/step-link";
import { PLACES, SAM, seedStorage } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

test("a step older than a day gets a tap-only check-in and moves to Done", async ({ page }) => {
  // "Saved N days ago" counts calendar days, so pin the page clock to the moment the steps were
  // made: a run that crosses midnight must not turn "2 days" into "3 days". Timers still run.
  const now = Date.now();
  await page.clock.setFixedTime(now);
  const steps: FirstStep[] = [
    { id: "new", kind: "say", text: "Ask Priya about Heartstopper", withPerson: "Priya", createdAt: now - 60_000, done: false },
    { id: "old", kind: "go", text: "Board-game café on Friday", withPerson: "Priya", createdAt: now - 2 * DAY - 60_000, done: false },
  ];
  await seedStorage(page, { profile: SAM, steps });
  await page.goto("/steps");
  await expect(page.getByRole("heading", { level: 1, name: "First Steps" })).toBeVisible();

  // Only the old step is asked about.
  const checkIn = page.getByRole("region", { name: "Did you do this?" });
  await expect(checkIn).toContainText("Board-game café on Friday");
  await expect(checkIn).toContainText("You saved this 2 days ago.");
  await expect(checkIn).not.toContainText("Heartstopper");

  await checkIn.getByRole("button", { name: "Yes, I did it" }).click();
  const feeling = page.getByRole("region", { name: "Nice one. How was it?" });
  await expect(feeling.getByRole("heading")).toBeFocused();
  await expect(feeling.getByRole("button")).toHaveText(["Easy", "OK", "Hard", "Skip"]);
  await feeling.getByRole("button", { name: "Easy" }).click();

  const thanks = page.getByRole("region", { name: "Easy. Great." });
  await expect(thanks).toContainText("Small steps add up. You did a real thing.");
  // A "go" step offers the next rung of the ladder, one tap to save.
  await expect(thanks).toContainText("Ready for a slightly bigger step?");
  await expect(thanks).toContainText("Go again and stay 20 minutes");

  // While the check-in card shows the step, it isn't listed a second time below it.
  await expect(page.getByRole("button", { name: /Board-game café on Friday/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I did it: Ask Priya about Heartstopper", exact: true })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as FirstStep[]);
  const old = saved.find((s) => s.id === "old")!;
  expect(old).toMatchObject({ done: true, feeling: "good" });
  expect(old.doneAt).toBeGreaterThanOrEqual(now);

  await thanks.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("region", { name: /Easy\. Great\.|Did you do this/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "First Steps" })).toBeFocused();

  // Now it is under Done, with a visible Undo.
  await expect(page.getByRole("heading", { level: 2, name: "Done", exact: true })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo: mark as not done: Board-game café on Friday" });
  await expect(undo).toHaveText("Undo");
  await expect(page.getByText(/shorter/i)).toHaveCount(0);
  await undo.click();
  await expect(page.getByRole("heading", { level: 2, name: "Done", exact: true })).toHaveCount(0);
});

const place = PLACES[0].name;
const goStep = (rung: number, text: string): FirstStep => ({
  id: `go${rung}`,
  kind: "go",
  text,
  createdAt: Date.now() - 60_000,
  done: false,
  rung,
});

test("the exposure ladder: each finished 'go' step offers the next, slightly bigger one", async ({ page }) => {
  await seedStorage(page, { profile: SAM, steps: [goStep(0, `Spend 10 minutes at ${place}`)] });
  await page.goto("/steps");

  // "I did it" on the row opens the same check-in as the reminder card.
  await page.getByRole("button", { name: `I did it: Spend 10 minutes at ${place}` }).click();
  const feeling = page.getByRole("region", { name: "Nice one. How was it?" });
  await expect(feeling.getByRole("heading")).toBeFocused();
  await feeling.getByRole("button", { name: "OK" }).click();

  const card = page.getByRole("region", { name: "OK still counts." });
  const next = `Go back to ${place} and stay 20 minutes`;
  await expect(card).toContainText(next);
  await card.getByRole("button", { name: "Save this step" }).click();
  await expect(card.getByRole("status")).toHaveText("Saved to your First Steps.");
  await card.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("button", { name: `I did it: ${next}` })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as FirstStep[]);
  expect(saved.find((s) => s.text === next)).toMatchObject({ kind: "go", rung: 1, done: false });
  expect(saved.find((s) => s.id === "go0")).toMatchObject({ done: true, feeling: "okay" });
});

test("a step that felt hard offers the same step again, not a bigger one", async ({ page }) => {
  await seedStorage(page, { profile: SAM, steps: [goStep(1, `Go back to ${place} and stay 20 minutes`)] });
  await page.goto("/steps");
  await page.getByRole("button", { name: /^I did it: Go back to/ }).click();
  await page.getByRole("region", { name: "Nice one. How was it?" }).getByRole("button", { name: "Hard" }).click();

  const card = page.getByRole("region", { name: "That took courage." });
  await expect(card).toContainText("Hard ones count the most, and you did it anyway.");
  await expect(card).toContainText("Try the same step again. No need to go bigger yet.");
  await expect(card).toContainText(`Go back to ${place} and stay 20 minutes`);
  await expect(card).not.toContainText("with someone");
});

test("at the top of the ladder there is no next step to offer", async ({ page }) => {
  await seedStorage(page, { profile: SAM, steps: [goStep(3, `Invite someone new to ${place}`)] });
  await page.goto("/steps");
  await page.getByRole("button", { name: /^I did it: Invite someone new/ }).click();
  await page.getByRole("region", { name: "Nice one. How was it?" }).getByRole("button", { name: "Easy" }).click();
  const card = page.getByRole("region", { name: "Easy. Great." });
  await expect(card).toContainText("You don't need me for this one any more.");
  await expect(card.getByRole("button", { name: "Save this step" })).toHaveCount(0);
});

test("opening a shared step that is already on the list doesn't save it twice", async ({ page }) => {
  const text = `Spend 10 minutes at ${place}`;
  await seedStorage(page, {
    profile: SAM,
    steps: [{ id: "a", kind: "go", text, withPerson: "Priya", createdAt: Date.now() - 60_000, done: false }],
  });
  await page.goto(`/steps?add=${encodeStepLink({ kind: "go", text, withPerson: "Priya" })}`);
  const incoming = page.getByRole("region", { name: "You already saved this one" });
  await expect(incoming).toContainText(text);
  await incoming.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(/\/steps$/);
  await expect(page.getByRole("button", { name: `I did it: ${text}` })).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as FirstStep[]);
  expect(saved).toHaveLength(1);
});

test("D24: no location ask on /steps; with none stored, one plain line points to Settings", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await page.goto("/steps");
  const ladder = page.getByRole("region", { name: "Quiet to lively" });
  await expect(ladder.getByRole("heading", { name: /^Calm/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find places near me|Share location|Look again near me/ })).toHaveCount(0);
  await expect(ladder.getByRole("link", { name: "Places near you are off. Turn on in Your taste > Settings." })).toHaveAttribute("href", "/me#settings");
});

test("with a stored coarse location, real places fill the rungs without asking", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await page.addInitScript(() => {
    if (localStorage.getItem("larry.location")) return;
    localStorage.setItem("larry.location", JSON.stringify({ lat: 19.08, lon: 72.88, at: Date.now() }));
    localStorage.setItem("larry.location.choice", "on");
  });
  const asked: { lat?: number; lon?: number }[] = [];
  await page.route("**/api/places", async (route) => {
    asked.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ places: [{ ...PLACES[0], id: "lib1", name: "Title Waves Books", tags: ["Library"], vibe: "calm" }] }),
    });
  });
  await page.goto("/steps");
  const ladder = page.getByRole("region", { name: "Quiet to lively" });
  await expect(ladder.getByRole("button", { name: "Plan this: Title Waves Books" })).toBeVisible();
  // Only the stored coarse point was sent (about 1 km), never a fresh precise fix.
  expect(asked[0]).toMatchObject({ lat: 19.08, lon: 72.88 });
  await expect(ladder.getByRole("status")).toContainText("Larry (an AI) found these places near you");
});
