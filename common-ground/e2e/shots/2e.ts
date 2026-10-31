// 2E review screenshots (not a test): the Taste Fingerprint on /me with the count and the Ask-me line,
// its share image as drawn (QR to "make your own card"), and an under-18 share image with no QR.
// Every model and Qloo call is mocked. Run with `npx tsx e2e/review-shots.ts 2e [job]`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const persona = { version: 1, name: "Sam", likes: SAM.items, dislikes: [], notes: [], updatedAt: 1 };
const win = JSON.stringify([{ id: "s1", text: "Go to the board game café", done: false }]);
const seedFor = (age: string) => ({ "larry.persona": JSON.stringify(persona), "larry.ageBucket": JSON.stringify(age), "cg.steps": win });
const FINGERPRINT = {
  offBeatenPct: 67,
  lessKnown: { count: 4, known: 6 },
  strongest: ["videogame", "artist"],
  twin: { fromDomain: "videogame", toDomain: "artist", entity: { id: "E2E-TWIN-1", name: "beabadoobee", domain: "artist" } },
  twinBecause: "Minecraft",
  caption: "Most of your picks skip the crowd. Minecraft and beabadoobee make a lot of sense together.",
  captionSource: "model",
};

async function fingerprintPage(kit: ShotKit, w: number, age = "18-24"): Promise<Page> {
  const ctx = await kit.context(w, seedFor(age));
  await ctx.route("**/api/fingerprint", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(FINGERPRINT) }));
  const page = await ctx.newPage();
  await page.goto("/me");
  await page.getByTestId("fingerprint-count").waitFor();
  return page;
}

async function saveCanvas(page: Page, kit: ShotKit, name: string) {
  const fp = page.getByRole("region", { name: "Your Taste Fingerprint" });
  await fp.getByRole("button", { name: "Share my Fingerprint" }).click();
  await fp.getByRole("status").filter({ hasText: /Downloaded|Shared/ }).waitFor();
  const data = await page.getByTestId("fingerprint-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL("image/png"));
  writeFileSync(path.join(kit.outDir, `${name}.png`), Buffer.from(data.split(",")[1], "base64"));
  console.log("saved", path.join(path.basename(kit.outDir), `${name}.png`));
}

export const jobs: ShotJob[] = [
  {
    name: "me-fingerprint",
    async run(kit, w) {
      const page = await fingerprintPage(kit, w);
      await page.getByRole("region", { name: "Your Taste Fingerprint" }).scrollIntoViewIfNeeded();
      await kit.shot(page, "2e-me-fingerprint", w);
      await page.context().close();
    },
  },
  {
    name: "share-image",
    widths: [390],
    async run(kit, w) {
      const page = await fingerprintPage(kit, w);
      await saveCanvas(page, kit, "2e-share-fingerprint");
      await page.context().close();
    },
  },
  {
    name: "share-image-under-18",
    widths: [390],
    async run(kit, w) {
      const page = await fingerprintPage(kit, w, "13-17");
      await saveCanvas(page, kit, "2e-share-fingerprint-under-18");
      await page.context().close();
    },
  },
];
