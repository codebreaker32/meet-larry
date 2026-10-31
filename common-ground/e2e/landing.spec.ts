import { expect, test } from "./fixtures";

test("landing shows the headline and its calls to action go where they say", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Talk to someone, not something." })).toBeVisible();
  // Larry's mascot sits on the play mat next to its first line.
  const mascot = page.getByRole("main").getByRole("img", { name: "Larry, an AI pal" }).first();
  await expect(mascot).toBeVisible();
  await expect.poll(() => mascot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // Friends-first: no rooms, no room codes, no one-phone example pair.
  const main = page.getByRole("main");
  for (const gone of ["Create a room", "Join a room", "See an example pair"]) await expect(main.getByText(gone)).toHaveCount(0);
  await expect(main.getByText(/room code/i)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/\bu\/\w/);
  // Visitors never get Larry's next-move popup or its pill (signed-in people only).
  await expect(page.getByTestId("next-move-pill")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Larry's next move" })).toHaveCount(0);

  // Every way in is a real, 48px-or-taller target.
  for (const name of ["Make my taste card", "Start a group", "Scan a group QR", "Talk taste with Larry", "Pick a pal"]) {
    const link = main.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  await expect(main.getByRole("link", { name: "Start a group" })).toHaveAttribute("href", "/group/new");
  await expect(main.getByRole("link", { name: "Scan a group QR" })).toHaveAttribute("href", "/scan");

  await main.getByRole("link", { name: "Make my taste card" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { level: 1, name: "Make your taste card" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Talk taste with Larry" }).click();
  await expect(page).toHaveURL(/\/larry$/);

  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Pick a pal" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pick a pal" })).toBeVisible();
});

test("Larry is the face of the app: avatar logo in the header, the hero keeps its play-mat layout", async ({ page }) => {
  await page.goto("/");
  // The header logo is Larry's face plus the wordmark (the old card glyph is gone).
  const logo = page.getByRole("banner").getByRole("link", { name: "Larry home" });
  await expect(logo).toBeVisible();
  await expect(logo).toContainText("Larry");
  const face = logo.locator("img");
  await expect(face).toBeVisible();
  await expect.poll(() => face.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const logoBox = await logo.boundingBox();
  expect(logoBox!.height).toBeGreaterThanOrEqual(48);

  // The user preferred the original hero: no big mascot above the headline (Larry sits on the play mat instead).
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  const imgs = page.getByRole("main").getByRole("img", { name: "Larry, an AI pal" });
  for (const box of await Promise.all((await imgs.all()).map((i) => i.boundingBox()))) {
    if (box) expect(box.y).toBeGreaterThan(h1!.y);
  }
});

test("a first visit sees the landing only: no app card and no next-move card", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  await expect(page.getByTestId("next-move")).toHaveCount(0);
});

test("the landing steps read Pick. Find. Go out.", async ({ page }) => {
  await page.goto("/");
  for (const verb of ["Pick.", "Find.", "Go out."]) await expect(page.getByText(verb, { exact: true })).toBeVisible();
});
