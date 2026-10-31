import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { SAM, seedStorage } from "./helpers";

// Demo friends for judges (next-round-queue.md). The one demo account comes with 5 made-up demo
// friends, two ready-made groups opened by Larry, and "Let a demo friend scan it" on its live QR.
// Real accounts never see the button and the route answers them with a plain 404.
// In-memory database; Qloo is the dev-only fake (x-e2e-fake-qloo) and the model never runs.
//
// The demo account is recognised only from the verified phone claim, which fake e2e tokens don't
// carry. The demo-account test runs when the dev server maps E2E_DEMO_UID's fake token to DEMO_PHONE
// (E2E only, never in production); otherwise it is skipped.

const DEMO_UID = process.env.E2E_DEMO_UID ?? "";

async function signedIn(context: BrowserContext, page: Page, name: string, uid: string) {
  const auth = { authorization: `Bearer e2e:${uid}` };
  const { username } = (await (await page.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  const made = await page.request.post("/api/account", { data: { name, username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
  expect(made.status(), await made.text()).toBeLessThan(300);
  await context.addInitScript((id) => {
    localStorage.setItem("larry.e2e.uid", id);
    localStorage.setItem("larry.location.choice", "off");
  }, uid);
  const fake = (route: Parameters<Parameters<BrowserContext["route"]>[1]>[0]) =>
    route.continue({ headers: { ...route.request().headers(), "x-e2e-fake-qloo": "1" } });
  await context.route("**/api/groups", fake);
  await context.route("**/api/groups/**", fake);
  return auth;
}

const uniqueUid = (who: string) => `demofr-${who}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

test("a real account never sees Let a demo friend scan it, and the route answers 404", async ({ page, context }) => {
  const auth = await signedIn(context, page, "Priya", uniqueUid("real"));
  await seedStorage(page, { profile: SAM });

  await page.goto("/group/new");
  await page.getByRole("radio", { name: "3 people" }).check();
  const asked = page.waitForResponse((r) => /\/api\/groups\/[^/]+\/demo-friends$/.test(r.url()) && r.request().method() === "GET");
  await page.getByRole("button", { name: "Show the QR" }).click();
  await expect(page.getByRole("img", { name: "QR code to join this group" })).toBeVisible({ timeout: 30_000 });
  expect((await asked).status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Let a demo friend scan it" })).toHaveCount(0);
  await expect(page.getByText(/Demo friend/)).toHaveCount(0);

  const groupId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  const get = await page.request.get(`/api/groups/${groupId}/demo-friends`, { headers: auth });
  expect(get.status()).toBe(404);
  const post = await page.request.post(`/api/groups/${groupId}/demo-friends`, { data: { friend: "mira" }, headers: auth });
  expect(post.status()).toBe(404);
  // Nobody joined, and the real account has no ready-made groups.
  const list = (await (await page.request.get("/api/groups", { headers: auth })).json()) as { groups: { names: string[] }[] };
  expect(list.groups).toHaveLength(1);
  expect(list.groups[0].names).toEqual([]);
});

test("the demo account: two ready-made groups opened by Larry, then demo friends scan its live QR", async ({ page, context }, info) => {
  test.skip(!DEMO_UID, "Needs a dev server that maps E2E_DEMO_UID to the demo account.");
  test.skip(info.project.name === "mobile" && !process.env.DEMO_FRIENDS_MOBILE, "Once is enough; the layout is shared.");
  test.setTimeout(120_000);
  await signedIn(context, page, "Demo", DEMO_UID);
  await seedStorage(page, { profile: SAM });

  // The ready-made groups: one-to-one with Hana, and a group of four. Every demo friend is labelled.
  await page.goto("/group");
  await expect(page.getByText("Hana (Demo friend)", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Mira (Demo friend), Arjun (Demo friend) and Rafa (Demo friend)")).toBeVisible();

  await page.getByText("Hana (Demo friend)", { exact: true }).click();
  await expect(page.locator('[data-bubble="larry"]').first()).toContainText("I'm Larry, an AI pal", { timeout: 30_000 });
  await expect(page.getByText(/I'm a demo friend, so this is my only line/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-bubble="person"]').filter({ hasText: /only line/ })).toContainText("Hana (Demo friend)");
  await expect(page.getByText(/with a demo friend/)).toBeVisible();
  await page.getByRole("button", { name: /^Members/ }).click();
  const members = page.getByRole("dialog", { name: /Who's here/ });
  await expect(members.getByText("Hana (Demo friend)")).toBeVisible();
  // A demo friend has no profile link.
  await expect(members.getByRole("link", { name: /Hana/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A new group of 3: the live QR offers the demo friends.
  await page.goto("/group/new");
  await page.getByRole("radio", { name: "3 people" }).check();
  await page.getByRole("button", { name: "Show the QR" }).click();
  await expect(page.getByRole("img", { name: "QR code to join this group" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Let a demo friend scan it" })).toBeVisible();
  const tara = page.getByRole("button", { name: /^Tara \(Demo friend\)/ });
  await expect(tara).toBeVisible();
  const box = await tara.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await tara.click();
  await expect(page.getByText("2 of 3 here")).toBeVisible();
  await expect(tara).toHaveCount(0);
  await page.getByRole("button", { name: /^Mira \(Demo friend\)/ }).click();

  // Full: the QR goes, Larry opens the group, then the demo friend says one labelled line.
  await expect(page.getByRole("img", { name: "QR code to join this group" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-bubble="larry"]').first()).toContainText("I'm Larry, an AI pal", { timeout: 30_000 });
  await expect(page.getByText(/I'm a demo friend, so this is my only line/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-bubble="person"]').filter({ hasText: /only line/ })).toContainText(/(Tara|Mira) \(Demo friend\)/);
});
