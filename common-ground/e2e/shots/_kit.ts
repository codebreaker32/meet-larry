// Shared kit for review screenshots (e2e/review-shots.ts loads every e2e/shots/*.ts file).
// Not a test. Every model call is mocked at the HTTP boundary; nothing here spends AI time.
import { homedir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const CHROME = process.env.PW_CHROME || path.join(homedir(), ".cache/ms-playwright/chromium-1208/chrome-linux64/chrome");
/** Widths every job runs at unless it names its own. */
export const DEFAULT_WIDTHS = [1440, 390];

export interface ShotKit {
  browser: Browser;
  /** Where this file's screenshots go (.impeccable/review/<file name>). */
  outDir: string;
  /**
   * A fresh context at this width: phone-sized below 600px, reduced motion, a made-up IP, the
   * fake e2e venue's geolocation, localStorage seeded once, and /api/suggest answered with a fixed line.
   */
  context(width: number, seed?: Record<string, string>, headers?: Record<string, string>): Promise<BrowserContext>;
  /** Waits a moment for motion to settle, then saves `<name>-<width>.png`. */
  shot(page: Page, name: string, width: number, fullPage?: boolean): Promise<void>;
}

export interface ShotJob {
  /** Short name, used to run one job: `npx tsx e2e/review-shots.ts <file> <job>`. */
  name: string;
  run(kit: ShotKit, width: number): Promise<void>;
  widths?: number[];
}

export function makeKit(browser: Browser, outDir: string): ShotKit {
  return {
    browser,
    outDir,
    async context(width, seed = {}, headers = {}) {
      const ctx = await browser.newContext({
        baseURL: BASE,
        viewport: { width, height: width < 600 ? 844 : 900 },
        isMobile: width < 600,
        hasTouch: width < 600,
        reducedMotion: "reduce",
        extraHTTPHeaders: { "x-real-ip": `10.99.0.${Math.floor(Math.random() * 200) + 1}`, "x-e2e-no-model": "1", ...headers },
        // At the fake e2e venue (E2E_VENUE_LOCATION), for Open to meet's presence check.
        geolocation: { latitude: 51.5072, longitude: -0.1276, accuracy: 20 },
        permissions: ["geolocation"],
      });
      await ctx.addInitScript((s) => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      }, seed);
      // The Fingerprint calls Qloo: a fixed answer (a shot module may answer it itself).
      await ctx.route("**/api/fingerprint", (r) =>
        r.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ offBeatenPct: 72, lessKnown: { count: 3, known: 4 }, strongest: ["videogame", "artist"], caption: "Most of your picks skip the crowd.", captionSource: "fallback" }),
        }),
      );
      await ctx.route("**/api/suggest", (r) =>
        r.fulfill({ contentType: "application/json", body: JSON.stringify({ steps: [], nudges: ["Small hellos count."], fallback: false }) }),
      );
      return ctx;
    },
    async shot(page, name, width, fullPage = false) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage });
      console.log("saved", path.join(path.basename(outDir), `${name}-${width}.png`));
    },
  };
}
