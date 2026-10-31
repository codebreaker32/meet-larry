import { expect, test } from "./fixtures";
import { cardHeading, code, SAM } from "./helpers";

test("create a card by tapping only (sport and players too, no pick limit), then see the way to a group", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByRole("heading", { level: 1, name: "Make your taste card" })).toBeVisible();
  const kinds = page.getByRole("group", { name: "What kind of thing?" });

  for (const title of ["Spirited Away", "Interstellar", "Barbie", "Your Name."]) {
    const tile = page.getByRole("button", { name: title, exact: true });
    await tile.click();
    await expect(tile).toHaveAttribute("aria-pressed", "true");
  }
  await kinds.getByRole("button", { name: "Games", exact: true }).click();
  for (const title of ["Minecraft", "Stardew Valley", "Hollow Knight"]) await page.getByRole("button", { name: title, exact: true }).click();

  // Sports teams, with a sport filter.
  await kinds.getByRole("button", { name: "Sports", exact: true }).click();
  const sports = page.getByRole("group", { name: "Which sport?" });
  await sports.getByRole("button", { name: "Cricket", exact: true }).click();
  await expect(sports.getByRole("button", { name: "Cricket", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Real Madrid CF", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Mumbai Indians", exact: true }).click();
  await page.getByRole("button", { name: "Chennai Super Kings", exact: true }).click();

  // Players.
  await kinds.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByRole("button", { name: "Virat Kohli", exact: true }).click();
  await page.getByRole("button", { name: "Smriti Mandhana", exact: true }).click();
  await kinds.getByRole("button", { name: "Podcasts", exact: true }).click();
  await page.getByRole("button", { name: "Stuff You Should Know", exact: true }).click();

  // No limit: 12 picks, and the card itself shows the first 10.
  const picks = page.getByRole("heading", { name: /Your picks/ });
  await expect(picks).toContainText("12 picked");
  await expect(page.getByText("Pick as many as you like. Your card shows the first 10.")).toBeVisible();

  // The visible remove control on a pick takes it off the card.
  await page.getByRole("button", { name: "Remove Barbie" }).click();
  await expect(page.getByRole("button", { name: "Remove Barbie" })).toHaveCount(0);
  await expect(picks).toContainText("11 picked");

  // Saving asks for a name first: the instruction is plain text beside the button, and tapping
  // the (secondary-looking) button takes you to the name field.
  await expect(page.getByText("Now add your first name.").filter({ visible: true }).first()).toBeVisible();
  const saveBtn = page.getByRole("button", { name: "Save my card" }).filter({ visible: true }).first();
  await expect(saveBtn).toHaveAttribute("aria-disabled", "true");
  // force: Playwright treats aria-disabled as not clickable, but a real tap still lands.
  await saveBtn.click({ force: true });
  await expect(page.getByLabel("Your first name")).toBeFocused();
  await page.getByLabel("Your first name").fill("Alex");

  // Age is asked once, as a range, never a birthday. Saving waits for it and takes you to it.
  await expect(page.getByText("Last one: pick your age range.").filter({ visible: true }).first()).toBeVisible();
  await expect(saveBtn).toHaveAttribute("aria-disabled", "true");
  await saveBtn.click({ force: true });
  const ages = page.getByRole("radiogroup", { name: "How old are you?" });
  await expect(ages.getByRole("radio")).toHaveCount(5);
  await expect(ages.getByRole("radio", { name: "13–17" })).toBeFocused();
  await expect(page.getByRole("radio", { name: /under 13/i })).toHaveCount(0);
  await ages.getByRole("radio", { name: "18–24" }).click();
  // Mood is optional and one tap; tapping it again would clear it.
  const moods = page.getByRole("group", { name: /How are you feeling today/ });
  await moods.getByRole("button", { name: "Curious" }).click();
  await expect(moods.getByRole("button", { name: "Curious" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Show me something I don't know.", { exact: true })).toBeVisible();
  await expect(saveBtn).toHaveAttribute("aria-disabled", "false");
  await saveBtn.click();

  // D24: the one location ask comes right after "Save my card". "Not now" is remembered.
  const ask = page.getByTestId("location-ask");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Not now" }).click();

  await expect(page).toHaveURL(/\/card$/);
  const stored = await page.evaluate(() => ({
    age: JSON.parse(localStorage.getItem("larry.ageBucket") ?? "null"),
    mood: JSON.parse(localStorage.getItem("larry.mood") ?? "null"),
    choice: localStorage.getItem("larry.location.choice"),
  }));
  expect(stored).toEqual({ age: "18-24", mood: "curious", choice: "off" });
  await expect(page.getByRole("heading", { level: 1, name: "Your taste card" })).toBeVisible();
  await expect(page.getByRole("heading", { name: cardHeading("Alex") })).toBeVisible();
  await expect(page.getByText(/Larry keeps all 11 on this phone/)).toBeVisible();
  // Friends-first: the card leads to a group QR, never a one-phone pair link.
  await expect(page.getByRole("link", { name: "Start a group" }).first()).toHaveAttribute("href", "/group/new");
  await expect(page.getByRole("link", { name: "Scan a group QR" })).toHaveAttribute("href", "/scan");
  await expect(page.getByRole("button", { name: "Show my QR code" })).toHaveCount(0);

  // Everything is kept on the phone as the persona; the shared card is the first 10.
  const persona = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.persona") ?? "null"));
  expect(persona.name).toBe("Alex");
  expect(persona.likes).toHaveLength(11);
  const names = persona.likes.map((i: { name: string }) => i.name);
  expect(names).not.toContain("Barbie");
  expect(names).toEqual(expect.arrayContaining(["Spirited Away", "Mumbai Indians", "Virat Kohli", "Smriti Mandhana"]));
  expect(persona.likes.find((i: { name: string }) => i.name === "Mumbai Indians").domain).toBe("sports_team");
  expect(persona.likes.find((i: { name: string }) => i.name === "Virat Kohli").domain).toBe("athlete");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.profile") ?? "null"));
  expect(saved.items).toHaveLength(10);
});

// The one-phone pair flow (/join, /pair) is retired (D25, D26): friends meet by a group QR.
test("the old card join link is gone", async ({ page }) => {
  const res = await page.goto(`/join?c=${code(SAM)}`);
  expect(res?.status()).toBe(404);
});

test("age: 'I'm younger' gets a kind message and no card; a known age range is never asked again", async ({ page }) => {
  await page.goto("/create");
  for (const title of ["Spirited Away", "Interstellar", "Barbie"]) await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByLabel("Your first name").fill("Kit");
  await page.getByRole("button", { name: "I'm younger" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thanks for stopping by!" })).toBeVisible();
  await expect(page.getByText(/for people who are 13 or older/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("larry.persona"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("larry.ageBucket"))).toBeNull();

  // Asked before (or set from a signed-in account): the question is skipped, and so is a location
  // ask that was already answered.
  await page.evaluate(() => {
    localStorage.setItem("larry.ageBucket", JSON.stringify("25-34"));
    localStorage.setItem("larry.location.choice", "off");
  });
  await page.goto("/create");
  for (const title of ["Spirited Away", "Interstellar", "Barbie"]) await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByLabel("Your first name").fill("Kit");
  await expect(page.getByRole("radiogroup", { name: "How old are you?" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save my card" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/card$/);
});

test("picture-first: Popular and Big near you rows come before search", async ({ page }) => {
  await page.goto("/create");
  const popular = page.getByRole("region", { name: "Popular" });
  const local = page.getByRole("region", { name: "Big near you" });
  await expect(popular.getByRole("button", { name: "Spirited Away", exact: true })).toBeVisible();
  await expect(local.getByRole("button", { name: "3 Idiots", exact: true })).toBeVisible();
  const search = page.getByLabel("Can't see it? Search");
  const [localBox, searchBox] = [await local.boundingBox(), await search.boundingBox()];
  expect(localBox!.y).toBeLessThan(searchBox!.y);
});
