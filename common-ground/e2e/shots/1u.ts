// Builder 1U review screenshots: Larry's face (header logo) and the app card.
// Run with `npx tsx e2e/review-shots.ts 1u [job]`. No model calls: these pages make none.
import type { ShotJob, ShotKit } from "./_kit";
import { BASE } from "./_kit";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A returning visitor who has saved a Plan Ticket: the app card is unlocked. */
const RETURNING_WITH_WIN = {
  "larry.visit.first": "an-earlier-visit",
  "larry.app.win": JSON.stringify({ reason: "plan-ticket", at: Date.UTC(2026, 9, 30) }),
};

async function landing(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await kit.shot(page, "landing-first-visit", w);
  await kit.shot(page, "landing-full", w, true);
  await ctx.close();
}

/** The card as an iPhone sees it (the picture steps open) and, on phones, in the menu. */
async function appCard(kit: ShotKit, w: number) {
  const phone = w < 600;
  const ctx = await kit.browser.newContext({
    baseURL: BASE,
    viewport: { width: w, height: phone ? 844 : 900 },
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: "reduce",
    userAgent: IPHONE_UA,
  });
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, RETURNING_WITH_WIN);
  const page = await ctx.newPage();
  await page.goto("/");
  const card = page.getByRole("main").getByTestId("app-card");
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  await kit.shot(page, "app-card-landing", w);
  await card.getByRole("button", { name: "Show me how" }).click();
  await card.getByText("Add to Home Screen").waitFor();
  await kit.shot(page, "app-card-iphone-steps", w);
  if (phone) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("banner").getByRole("button", { name: "Menu" }).click();
    await page.getByRole("banner").getByTestId("app-card").waitFor();
    await kit.shot(page, "app-card-menu", w);
  }
  await ctx.close();
}

export const jobs: ShotJob[] = [
  { name: "landing", run: landing },
  { name: "appcard", run: appCard },
];
