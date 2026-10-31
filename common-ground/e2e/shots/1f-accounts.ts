// Stage 1 review screenshots for 1F Accounts. Not a test.
// Run with `npx tsx e2e/review-shots.ts 1f-accounts [job]` against a dev server started with
// NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory (the fake phone sign-in: code 123456; no SMS, no Firestore).
import type { Page } from "@playwright/test";
import type { ShotJob } from "./_kit";

const persona = JSON.stringify({ version: 1, name: "Sam", likes: [], dislikes: [], notes: [], updatedAt: 1 });
const phone = () => `+9198${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

async function fakeSignIn(page: Page) {
  await page.goto("/signin?next=%2Fcode");
  await page.getByLabel("Your phone number").fill(phone());
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("The 6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/signup/);
}

export const jobs: ShotJob[] = [
  {
    name: "signin",
    async run(kit, width) {
      const ctx = await kit.context(width);
      const page = await ctx.newPage();
      await page.goto("/signin");
      await page.getByRole("heading", { name: "What we keep" }).waitFor();
      await kit.shot(page, "signin-phone", width, true);
      await page.getByLabel("Your phone number").fill(phone());
      await page.getByRole("button", { name: "Text me a code" }).click();
      await page.getByRole("heading", { name: "Check your texts" }).waitFor();
      await kit.shot(page, "signin-code", width);
      await ctx.close();
    },
  },
  {
    name: "signup",
    async run(kit, width) {
      const ctx = await kit.context(width);
      const page = await ctx.newPage();
      await fakeSignIn(page);
      await page.getByRole("heading", { name: "Before we start" }).waitFor();
      await kit.shot(page, "signup-1-store", width, true);
      await page.getByRole("button", { name: "Sounds good" }).click();
      await page.getByLabel("Your name").fill("Sam");
      await kit.shot(page, "signup-2-name", width);
      await page.getByRole("button", { name: "Next" }).click();
      await page.locator("p[aria-live=polite]").filter({ hasText: /^[A-Z][a-z]+[A-Z][a-z]+\d+$/ }).waitFor();
      await kit.shot(page, "signup-3-username", width);
      await page.getByRole("button", { name: "Use this name" }).click();
      await page.getByLabel("Day").selectOption("2");
      await page.getByLabel("Month").selectOption({ label: "March" });
      await page.getByLabel("Year").selectOption("1994");
      await kit.shot(page, "signup-4-dob", width);
      await page.getByRole("button", { name: "Make my account" }).click();
      await page.getByText(/You're in\./).waitFor();
      await kit.shot(page, "signup-5-done", width);
      await page.goto("/me#account");
      await kit.shot(page, "me-account", width, true);
      await ctx.close();
    },
  },
  {
    name: "prompt",
    async run(kit, width) {
      const ctx = await kit.context(width, { "larry.persona": persona });
      const page = await ctx.newPage();
      await page.goto("/larry");
      // The prompt an AI route opens on a 401 (fired directly, so no model route is called).
      const heading = page.getByRole("dialog").getByRole("heading", { name: "Get your Larry time" });
      for (let i = 0; i < 20 && !(await heading.isVisible()); i++) {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("larry:access", { detail: { state: "missing" } })));
        await page.waitForTimeout(500);
      }
      await page.getByRole("dialog").getByRole("heading", { name: "Get your Larry time" }).waitFor();
      await kit.shot(page, "larry-time-prompt", width);
      await page.goto("/code");
      await kit.shot(page, "code-page", width, true);
      await ctx.close();
    },
  },
];
