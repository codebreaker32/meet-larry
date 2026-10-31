// 2C review screenshots: groups (D25, D26). Start a group (size picker), the live group QR, the scan
// page's join preview, the chat after Larry's opening common ground (bridges with "Why this?"), the
// @Larry command menu, the group Plan Ticket and the safety dialogs. Two real e2e accounts on the
// in-memory database; Qloo is the dev-only fake (x-e2e-fake-qloo) and the model never runs (x-e2e-larry).
// Run: `E2E_BASE_URL=http://localhost:3203 npx tsx e2e/review-shots.ts 2c [job]` against a dev server
// started with NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory.
import type { BrowserContext, Page } from "@playwright/test";
import { DEMO_PRIYA, DEMO_SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const larryLine = (text: string) => encodeURIComponent(JSON.stringify({ text }));

const persona = (p: typeof DEMO_SAM) =>
  JSON.stringify({ version: 1, name: p.name, likes: p.items, dislikes: [], notes: [], updatedAt: Date.now() });

/** A signed-in 18+ account on this context (fake e2e token), with its taste card on the phone. */
async function account(kit: ShotKit, width: number, p: typeof DEMO_SAM): Promise<{ ctx: BrowserContext; page: Page; auth: Record<string, string> }> {
  const uid = `shot2c-${p.name.toLowerCase()}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const auth = { authorization: `Bearer e2e:${uid}` };
  const ctx = await kit.context(width, { "larry.persona": persona(p), "larry.location.choice": "off" });
  await ctx.addInitScript((id) => localStorage.setItem("larry.e2e.uid", id), uid);
  await ctx.route("**/api/groups/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-e2e-fake-qloo": "1",
        ...(route.request().url().endsWith("/messages") ? { "x-e2e-larry": larryLine("Here's a plan for you both.") } : {}),
      },
    }),
  );
  const page = await ctx.newPage();
  const { username } = (await (await page.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  await page.request.post("/api/account", { data: { name: p.name, username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
  return { ctx, page, auth };
}

/** Sam starts a group of 2 and shows the QR; returns the group id and the join token. */
async function startGroup(page: Page): Promise<{ id: string; token: string }> {
  await page.goto("/group/new");
  await page.getByRole("button", { name: "Show the QR" }).click();
  await page.waitForURL(/\/group\/(?!new$)[^/]+$/, { timeout: 60_000 });
  await page.getByRole("img", { name: "QR code to join this group" }).waitFor();
  const id = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  const token = await page.evaluate((g) => JSON.parse(sessionStorage.getItem(`larry.group.join.${g}`) ?? "{}").token as string, id);
  return { id, token };
}

async function formed(kit: ShotKit, w: number) {
  const sam = await account(kit, w, DEMO_SAM);
  const priya = await account(kit, w, DEMO_PRIYA);
  const { id, token } = await startGroup(sam.page);
  await priya.page.goto(`/scan#t=${token}`);
  await priya.page.getByRole("button", { name: "Join the group" }).click();
  await priya.page.waitForURL(new RegExp(`/group/${id}$`));
  await priya.page.getByRole("button", { name: /Why this\?/ }).first().waitFor({ timeout: 30_000 });
  return { sam, priya, id };
}

async function done(...accounts: { ctx: BrowserContext; page: Page; auth: Record<string, string> }[]) {
  for (const a of accounts) {
    await a.page.request.delete("/api/account", { headers: a.auth }).catch(() => {});
    await a.ctx.close();
  }
}

export const jobs: ShotJob[] = [
  {
    name: "new",
    async run(kit, w) {
      const sam = await account(kit, w, DEMO_SAM);
      await sam.page.goto("/group/new");
      await sam.page.getByRole("radio", { name: "3 people" }).click();
      await kit.shot(sam.page, "2c-new", w, true);
      await done(sam);
    },
  },
  {
    name: "qr",
    async run(kit, w) {
      const sam = await account(kit, w, DEMO_SAM);
      await startGroup(sam.page);
      await kit.shot(sam.page, "2c-qr", w, true);
      await done(sam);
    },
  },
  {
    name: "scan",
    async run(kit, w) {
      const sam = await account(kit, w, DEMO_SAM);
      const priya = await account(kit, w, DEMO_PRIYA);
      const { token } = await startGroup(sam.page);
      await priya.page.goto(`/scan#t=${token}`);
      await priya.page.getByRole("button", { name: "Join the group" }).waitFor();
      await kit.shot(priya.page, "2c-scan-preview", w, true);
      await priya.page.goto("/scan");
      await kit.shot(priya.page, "2c-scan", w, true);
      await done(sam, priya);
    },
  },
  {
    name: "chat",
    async run(kit, w) {
      const { sam, priya } = await formed(kit, w);
      await kit.shot(priya.page, "2c-chat-opening", w);
      await priya.page.getByRole("button", { name: "@Larry", exact: true }).click();
      await priya.page.getByRole("listbox", { name: "Ask Larry" }).waitFor();
      await kit.shot(priya.page, "2c-chat-menu", w);
      await priya.page.keyboard.press("Escape");
      await priya.page.getByRole("button", { name: "Unfriend", exact: true }).click();
      await priya.page.getByRole("dialog").waitFor();
      await kit.shot(priya.page, "2c-unfriend", w);
      await done(sam, priya);
    },
  },
  {
    name: "list",
    async run(kit, w) {
      const { sam, priya } = await formed(kit, w);
      await sam.page.goto("/group");
      await sam.page.getByRole("link", { name: /Priya/ }).waitFor();
      await kit.shot(sam.page, "2c-list", w, true);
      await done(sam, priya);
    },
  },
];
