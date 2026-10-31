import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { SAM } from "./helpers";
import type { FingerprintView } from "../src/lib/fingerprint";
import { LESS_KNOWN_TOO_FEW, TITLE_WORDS } from "../src/lib/fingerprint";

// The Taste Fingerprint on /me (qloo-hooks-plan 3.2): a count, never a percentage; the Taste Twin as
// an "Ask me about ..." line; sharing only after a real win; the image QR only opens "make your own
// card" (never /join or /pair) and is left off for under-18s. /api/fingerprint is mocked here (its
// Qloo and model logic is unit-tested in src/lib/fingerprint.test.ts).

const VENUE = "Dice & Tea Board Game Cafe";
const persona = {
  version: 1,
  name: "Sam",
  likes: SAM.items,
  dislikes: [],
  notes: [],
  updatedAt: 1,
};

/** What the server answers, with a caption that tries to sneak a title, Glory, a date and a venue in. */
const SNEAKY: FingerprintView = {
  offBeatenPct: 67,
  lessKnown: { count: 4, known: 6 },
  strongest: ["videogame", "artist"],
  twin: { fromDomain: "videogame", toDomain: "artist", entity: { id: "E2E-TWIN-1", name: "beabadoobee", domain: "artist" } },
  twinBecause: "Minecraft",
  caption: `Final Boss of ${VENUE} with 312 Glory since 30 Oct.`,
  captionSource: "model",
};
const GOOD: FingerprintView = { ...SNEAKY, caption: "Most of your picks skip the crowd. Minecraft and beabadoobee make sense together." };

/** A saved plan on this phone: the real win that unlocks sharing. */
const WIN = { "cg.steps": JSON.stringify([{ id: "s1", text: "Go to the board game café", done: false }]) };
const ADULT = { "larry.ageBucket": JSON.stringify("18-24") };

async function seed(page: Page, extra: Record<string, string> = {}) {
  await page.addInitScript(
    ([p, more]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("larry.persona", p);
      for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
    },
    [JSON.stringify(persona), extra] as const,
  );
}

async function mockFingerprint(page: Page, view: FingerprintView) {
  const bodies: unknown[] = [];
  await page.route("**/api/fingerprint", (r) => {
    bodies.push(JSON.parse(r.request().postData() ?? "{}"));
    return r.fulfill({ contentType: "application/json", body: JSON.stringify(view) });
  });
  return bodies;
}

/** Every string the share canvas drew. */
const drawnLines = async (page: Page, testId: string) =>
  JSON.parse((await page.getByTestId(testId).getAttribute("data-share-lines")) ?? "[]") as string[];

function expectShareSafe(lines: string[], venues: string[]) {
  const all = lines.join(" | ");
  for (const w of TITLE_WORDS) expect(all).not.toMatch(new RegExp(`\\b${w}\\b`, "i"));
  for (const v of venues) expect(all).not.toContain(v);
  expect(all).not.toMatch(/\b(?:19|20)\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
}

test("/me: a count from real scores, the Ask-me line, and a share image whose QR only makes your own card", async ({ page }) => {
  await seed(page, { ...WIN, ...ADULT });
  const bodies = await mockFingerprint(page, GOOD);
  await page.goto("/me");

  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await expect(fp.getByTestId("fingerprint-count")).toHaveText("4 of your 6 picks are outside the top 10% most popular.");
  await expect(fp.getByText("Ask me about beabadoobee.")).toBeVisible();
  await expect(fp.getByText("Larry found that people who like Minecraft also like beabadoobee.")).toBeVisible();
  await expect(fp.getByText(GOOD.caption!)).toBeVisible();
  // The old percentage and "Strongest in" are gone.
  await expect(fp.getByText(/off the beaten path|Strongest in/)).toHaveCount(0);
  expect(bodies[0]).toEqual({ card: { name: "Sam", items: SAM.items } });

  await fp.getByRole("button", { name: "Share my Fingerprint" }).click();
  await expect(fp.getByRole("status").filter({ hasText: /Downloaded|Shared/ })).toBeVisible();
  const canvas = page.getByTestId("fingerprint-canvas");
  const lines = await drawnLines(page, "fingerprint-canvas");
  // Lines wrap by the canvas font, so check the joined text.
  expect(lines.join(" ")).toContain("Ask me about beabadoobee.");
  expect(lines.join(" ")).toContain("Talk to someone, not something.");
  expect(lines.join(" ")).toContain("4 of my 6 picks");
  expect(lines.join(" ")).toContain("Scan to make your own card");
  const qr = await canvas.getAttribute("data-share-qr");
  expect(qr).toMatch(/\/create$/);
  expect(qr).not.toMatch(/join|pair|room|group|\?/);
});

test("under 18 (or no age): the share image has no QR at all", async ({ page }) => {
  await seed(page, { ...WIN, "larry.ageBucket": JSON.stringify("13-17") });
  await mockFingerprint(page, GOOD);
  await page.goto("/me");
  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await fp.getByRole("button", { name: "Share my Fingerprint" }).click();
  await expect(fp.getByRole("status").filter({ hasText: /Downloaded|Shared/ })).toBeVisible();
  expect(await page.getByTestId("fingerprint-canvas").getAttribute("data-share-qr")).toBeNull();
  expect((await drawnLines(page, "fingerprint-canvas")).join(" ")).not.toContain("Scan to");
});

test("sharing waits for a real win, and too few known picks gives no number", async ({ page }) => {
  await seed(page, ADULT);
  await mockFingerprint(page, { ...GOOD, lessKnown: undefined, offBeatenPct: undefined });
  await page.goto("/me");
  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await expect(fp.getByTestId("fingerprint-count")).toHaveText(LESS_KNOWN_TOO_FEW);
  await expect(fp.getByTestId("fingerprint-share-later")).toBeVisible();
  await expect(fp.getByRole("button", { name: "Share my Fingerprint" })).toHaveCount(0);

  // "Add one more?" has a way to do it: card editing opens with the picks kept, no name or age asked.
  await fp.getByRole("link", { name: "Add more picks" }).click();
  await expect(page).toHaveURL(/\/create\?edit=1/);
  await expect(page.getByRole("heading", { level: 1, name: "Add more picks" })).toBeVisible();
  for (const item of SAM.items) await expect(page.getByRole("button", { name: `Remove ${item.name}` })).toBeVisible();
  await expect(page.getByLabel(/first name/i)).toBeHidden();
  await expect(page.getByRole("radiogroup", { name: "How old are you?" })).toHaveCount(0);
  await page.getByRole("button", { name: `Remove ${SAM.items[0].name}` }).click();
  await page.getByRole("button", { name: "Save my picks" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/me$/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.persona") ?? "null"));
  expect(saved.name).toBe("Sam");
  expect(saved.likes.map((l: { id: string }) => l.id)).toEqual(SAM.items.slice(1).map((i) => i.id));
});

test("share image: a venue, title, Glory or date never reaches the picture", async ({ page }) => {
  // A real check-in place on this phone (also the win), which the caption also names.
  await seed(page, { ...ADULT, "larry.places": JSON.stringify([{ placeId: "p1", placeName: VENUE, visits: 3 }]) });
  await mockFingerprint(page, SNEAKY);
  await page.goto("/me");
  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await fp.getByRole("button", { name: "Share my Fingerprint" }).click();
  await expect(fp.getByRole("status").filter({ hasText: /Downloaded|Shared/ })).toBeVisible();
  const lines = await drawnLines(page, "fingerprint-canvas");
  expect(lines.length).toBeGreaterThan(3);
  expectShareSafe(lines, [VENUE]);
  expect(lines.join(" ")).not.toContain("312");
});

test("a failed Fingerprint says so warmly and tries again with one tap", async ({ page }) => {
  await seed(page);
  let n = 0;
  await page.route("**/api/fingerprint", (r) =>
    n++ === 0 ? r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Larry couldn't look that up just now. Try again?" }) }) : r.fulfill({ contentType: "application/json", body: JSON.stringify(GOOD) }),
  );
  await page.goto("/me");
  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await expect(fp.getByRole("alert")).toHaveText("Larry couldn't look that up just now. Try again?");
  await fp.getByRole("button", { name: "Try again" }).click();
  await expect(fp.getByTestId("fingerprint-count")).toHaveText("4 of your 6 picks are outside the top 10% most popular.");
});

test("/me settings: places near you switch and the age range", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 19.0761, longitude: 72.8777, accuracy: 30 });
  await seed(page, { "larry.ageBucket": JSON.stringify("18-24") });
  await mockFingerprint(page, GOOD);
  await page.goto("/me#settings");

  const settings = page.getByRole("region", { name: "Settings" });
  const places = settings.getByRole("switch", { name: /Places near you/ });
  await expect(places).toHaveAttribute("aria-checked", "false");
  await places.click();
  await expect(places).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByText(/Places near you are on/)).toBeVisible();
  // Only a rough spot is kept.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.location") ?? "null"));
  expect(stored).toMatchObject({ lat: 19.08, lon: 72.88 });
  await places.click();
  await expect(places).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => localStorage.getItem("larry.location"))).toBeNull();

  const age = settings.getByRole("radiogroup", { name: "Your age range" });
  await expect(age.getByRole("radio", { name: "18–24" })).toHaveAttribute("aria-checked", "true");
  await age.getByRole("radio", { name: "25–34" }).click();
  await expect(settings.getByText("Age range saved.")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("larry.ageBucket") ?? "null"))).toBe("25-34");

  // 1F's account panel lives here too (signed out: one sign-in button).
  await expect(page.getByRole("region", { name: "Your account" })).toBeVisible();
});
