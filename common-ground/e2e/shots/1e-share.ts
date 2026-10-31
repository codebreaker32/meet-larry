// 1E Share review shots (not a test): the Taste Fingerprint on /me, the /me settings, and the two
// share images exactly as drawn (saved straight from the canvas). Every model and Qloo call is mocked.
// Run with `npx tsx e2e/review-shots.ts 1e-share [job]`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { encodeProfile } from "../../src/lib/card-codec";
import { DEMO_PRIYA as PRIYA, DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const persona = { version: 1, name: "Sam", likes: SAM.items, dislikes: [], notes: [], updatedAt: 1 };
const seed = {
  "larry.persona": JSON.stringify(persona),
  "larry.ageBucket": JSON.stringify("18-24"),
};
const FINGERPRINT = {
  offBeatenPct: 72,
  strongest: ["videogame", "artist"],
  twin: { fromDomain: "videogame", toDomain: "artist", entity: { id: "E2E-TWIN-1", name: "beabadoobee", domain: "artist" } },
  twinBecause: "Minecraft",
  caption: "Most of your picks skip the crowd. Minecraft and beabadoobee make a lot of sense together.",
  captionSource: "model",
};

async function fingerprintPage(kit: ShotKit, w: number): Promise<Page> {
  const ctx = await kit.context(w, seed);
  await ctx.route("**/api/fingerprint", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(FINGERPRINT) }));
  const page = await ctx.newPage();
  await page.goto("/me");
  await page.getByText("72% off the beaten path", { exact: true }).waitFor();
  return page;
}

/** Saves what the canvas drew, at full size, as <name>.png (one file: the image doesn't depend on width). */
async function saveCanvas(page: Page, kit: ShotKit, testId: string, name: string) {
  const data = await page.getByTestId(testId).evaluate((c) => (c as HTMLCanvasElement).toDataURL("image/png"));
  const file = path.join(kit.outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data.split(",")[1], "base64"));
  console.log("saved", path.join(path.basename(kit.outDir), `${name}.png`));
}

export const jobs: ShotJob[] = [
  {
    name: "me-fingerprint",
    async run(kit, w) {
      const page = await fingerprintPage(kit, w);
      await page.getByRole("region", { name: "Your Taste Fingerprint" }).scrollIntoViewIfNeeded();
      await kit.shot(page, "me-fingerprint", w);
      await page.context().close();
    },
  },
  {
    name: "me-settings",
    async run(kit, w) {
      const page = await fingerprintPage(kit, w);
      await page.getByRole("region", { name: "Settings" }).scrollIntoViewIfNeeded();
      await kit.shot(page, "me-settings", w);
      await page.context().close();
    },
  },
  {
    name: "fingerprint-image",
    widths: [390],
    async run(kit, w) {
      const page = await fingerprintPage(kit, w);
      await page.getByRole("button", { name: "Share my Fingerprint" }).click();
      await page.getByText(/Saved to your phone|Shared/).waitFor();
      await saveCanvas(page, kit, "fingerprint-canvas", "fingerprint-image");
      await kit.shot(page, "fingerprint-shared", w, true);
      await page.context().close();
    },
  },
  {
    name: "overlap-image",
    widths: [390],
    async run(kit, w) {
      const ctx = await kit.context(w, {
        "larry.location": JSON.stringify({ lat: 51.51, lon: -0.13, at: Date.now() }),
        "larry.location.choice": "on",
      });
      const ground = {
        shared: [],
        bridges: [
          { id: "7826DA9C-F761-42A1-A948-90A700082B80", name: "mxmtoon", domain: "artist", affinity: 0.93, fromA: ["Avatar: The Last Airbender"], fromB: ["Heartstopper"] },
          { id: "B1A2C3D4-0000-4000-8000-000000000001", name: "Jojo Rabbit", domain: "movie", affinity: 0.81, fromA: ["Minecraft"], fromB: ["Little Women"] },
        ],
      };
      await ctx.route("**/api/common-ground", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(ground) }));
      await ctx.route("**/api/places", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ places: [] }) }));
      await ctx.route("**/api/chat", (r) =>
        r.fulfill({
          contentType: "application/x-ndjson",
          body: JSON.stringify({ type: "done", result: { messages: [{ from: "larry", text: "Hi Sam and Priya, I'm Larry, an AI pal." }], quiet: false, steps: [], profileUpdates: [] } }) + "\n",
        }),
      );
      const page = await ctx.newPage();
      await page.goto(`/pair?a=${encodeProfile(SAM)}&b=${encodeProfile(PRIYA)}&owner=b`);
      await page.getByRole("button", { name: "Finish" }).click();
      const other = page.getByRole("button", { name: "Other ideas" });
      if (await other.isVisible().catch(() => false)) await other.click();
      await page.getByRole("button", { name: "Share our overlap" }).click();
      await page.getByTestId("overlap-share").getByRole("status").filter({ hasText: /Saved|Shared/ }).waitFor();
      await saveCanvas(page, kit, "overlap-canvas", "overlap-image");
      await kit.shot(page, "overlap-panel", w);
      await ctx.close();
    },
  },
];
