import type { Browser } from "@playwright/test";
import { expect, test } from "./fixtures";

// Larry installs on a phone's home screen: a web app manifest, its icons, and the iPhone tags.

test("the web app manifest and its icons are served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: expect.stringContaining("Larry"), short_name: "Larry", start_url: "/", display: "standalone" });
  expect(manifest.theme_color.toLowerCase()).toBe("#f4f1ff");
  expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose?.includes("maskable"))).toBe(true);
  for (const icon of manifest.icons) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toContain("image/png");
  }

  // iPhone: Add to Home Screen uses the apple-touch icon and these tags.
  const apple = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute("href");
  expect((await request.get(apple!)).ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Larry");
});

test("the app icons are Larry's mascot at the sizes they say, and the favicon is served", async ({ page, request }) => {
  const icons = [
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
    ["/icons/icon-maskable-512.png", 512],
    ["/icons/apple-touch-icon.png", 180],
    ["/larry-192.png", 192],
    ["/larry-512.png", 512],
    ["/larry-512.webp", 512],
    ["/larry-face-96.png", 96],
    ["/larry-face-192.png", 192],
    ["/larry-face-192.webp", 192],
  ] as const;
  await page.goto("/");
  for (const [src, size] of icons) {
    const res = await request.get(src);
    expect(res.ok(), src).toBe(true);
    // Real images of the stated size (decoded by the browser).
    const dims = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, src);
    expect(dims, src).toEqual([size, size]);
  }
  // The maskable icon keeps the mascot inside the safe zone: its corners are the plain lilac background.
  const corner = await page.evaluate(async () => {
    const img = new Image();
    img.src = "/icons/icon-maskable-512.png";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(4, 4, 1, 1).data.slice(0, 3));
  });
  expect(corner).toEqual([0xf4, 0xf1, 0xff]);
  const fav = await request.get("/favicon.ico");
  expect(fav.ok()).toBe(true);
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** A returning visitor (an earlier visit on record) who has had a real win, seeded once per tab. */
const RETURNING_WITH_WIN = {
  "larry.visit.first": "an-earlier-visit",
  "larry.app.win": JSON.stringify({ reason: "plan-ticket", at: Date.UTC(2026, 9, 30) }),
};

async function iphone(browser: Browser, seed: Record<string, string> = RETURNING_WITH_WIN) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  return ctx;
}

test("after a real win, the app card stands out on the landing and shows iPhone picture steps", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone only.");
  const ctx = await iphone(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  const card = page.getByRole("main").getByTestId("app-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Get the Larry app" })).toBeVisible();
  await expect(card.getByText("Your Plan Tickets, one tap from your home screen.")).toBeVisible();
  // The real app icon is on it.
  await expect.poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Every target is at least 48px.
  for (const b of await card.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await card.getByRole("button", { name: "Show me how" }).click();
  await expect(card.getByText("Add to Home Screen")).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(3);

  // Not now: gone, and still gone after a reload (14 days).
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  await ctx.close();
});

test("the same app card sits in its own row in the phone menu", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone only.");
  const ctx = await iphone(browser);
  const page = await ctx.newPage();
  await page.goto("/create");
  await page.getByRole("banner").getByRole("button", { name: "Menu" }).click();
  const card = page.getByRole("banner").getByTestId("app-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Get the Larry app" })).toBeVisible();
  // Don't ask again: gone for good.
  await card.getByRole("button", { name: "Don't ask again" }).click();
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("larry.app.never"))).toBe("1");
  await ctx.close();
});

test("never offered to someone whose visit began on a QR link", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone only.");
  const ctx = await iphone(browser);
  const page = await ctx.newPage();
  await page.goto("/scan#t=not-a-real-token");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  await ctx.close();
});

test("on Android and Chrome, Get the app opens the browser's own install prompt", async ({ page }) => {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, RETURNING_WITH_WIN);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // No install event yet: this browser can't install, so no card.
  await expect(page.getByTestId("app-card")).toHaveCount(0);
  // The browser offers an install (as Chrome does when the app qualifies).
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => {
      (window as unknown as { __prompted: boolean }).__prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  const card = page.getByRole("main").getByTestId("app-card");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Get the app" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true);
  // Installed: the card goes.
  await expect(page.getByTestId("app-card")).toHaveCount(0);
});
