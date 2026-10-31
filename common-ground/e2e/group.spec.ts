import type { BrowserContext, Page } from "@playwright/test";
import type { PlanTicket } from "../src/lib/contracts";
import { E2E_NO_MODEL_HEADER, expect, freshIp, guardModel, larryHeader, test } from "./fixtures";
import { PRIYA, SAM, seedStorage } from "./helpers";

// Groups (D25, D26): two signed-in phones. Sam starts a group of 2 and shows the QR; Priya opens it
// (/scan#t=<token>) and joins. Larry opens the chat with their common ground ("Why this?"), then
// speaks only when tagged: @Larry -> Plan gives the group Plan Ticket. Unfriend closes the chat for
// the one who taps it, silently.
// Real group routes on the in-memory database; Qloo is the dev-only fake (x-e2e-fake-qloo) and the
// model never runs (x-e2e-larry).

const TICKET: PlanTicket = {
  place: {
    id: "E2E00000-0000-4000-8000-0000000000C1",
    name: "Dice and Tea Board Game Cafe",
    tags: ["Board games", "Calm"],
    affinity: 0.9,
    vibe: "calm",
    hours: "Daily 10:30am-7:30pm",
    slots: ["Sat 11am", "Sun 2pm"],
    reason: "A board-game café. Easy to sit and play.",
    fits: [],
  },
  when: "Sat 11am",
  item: { id: SAM.items[0].id, name: SAM.items[0].name, domain: SAM.items[0].domain },
  opener: "Which game would you teach a total beginner?",
};

/** A real account on the in-memory database, signed in on this context with the fake e2e token. */
async function signedIn(context: BrowserContext, page: Page, name: string) {
  const uid = `grp-${name.toLowerCase()}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const auth = { authorization: `Bearer e2e:${uid}` };
  const { username } = (await (await page.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  expect(username).not.toMatch(/^u\//);
  const made = await page.request.post("/api/account", { data: { name, username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
  expect(made.status(), await made.text()).toBeLessThan(300);
  await context.addInitScript((id) => {
    localStorage.setItem("larry.e2e.uid", id);
    localStorage.setItem("larry.location.choice", "off");
  }, uid);
  // Fake Qloo for the group's common ground, and a fixed Larry line instead of the model.
  await context.route("**/api/groups/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-e2e-fake-qloo": "1",
        ...(route.request().url().endsWith("/messages") ? { "x-e2e-larry": larryHeader({ text: "Here's a plan for you both." }) } : {}),
      },
    }),
  );
  return { uid, auth };
}

test("two phones: start a group of 2, scan the QR, Larry opens with common ground, @Larry Plan gives the ticket, Unfriend closes it", async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === "mobile", "Two signed-in phones once is enough; the mobile layout is in the shots.");
  test.setTimeout(120_000);

  // Sam, on this context.
  const sam = await signedIn(context, page, "Sam");
  await seedStorage(page, { profile: SAM });

  // Priya, on her own phone.
  const other = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": freshIp(), [E2E_NO_MODEL_HEADER]: "1" } });
  await guardModel(other);
  const priyaPage = await other.newPage();
  const priya = await signedIn(other, priyaPage, "Priya");
  await seedStorage(priyaPage, { profile: PRIYA });

  // Sam starts a group of 2 (the default) and shows the QR.
  await page.goto("/group/new");
  await expect(page.getByRole("heading", { level: 1, name: "Start a group" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "2, just us" })).toBeChecked();
  await page.getByRole("button", { name: "Show the QR" }).click();
  await expect(page).toHaveURL(/\/group\/(?!new$)[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("img", { name: "QR code to join this group" })).toBeVisible();
  await expect(page.getByText("Joining closes in 15 minutes")).toBeVisible();
  const groupId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  const token = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`larry.group.join.${id}`) ?? "{}").token as string, groupId);
  expect(token).toBeTruthy();

  // Priya scans it: the camera app opens /scan#t=<token>. The token leaves the address bar at once.
  await priyaPage.goto(`/scan#t=${token}`);
  await expect(priyaPage.getByRole("heading", { level: 1, name: "Join Sam's group?" })).toBeVisible();
  expect(new URL(priyaPage.url()).hash).toBe("");
  await priyaPage.getByRole("button", { name: "Join the group" }).click();
  await expect(priyaPage).toHaveURL(new RegExp(`/group/${groupId}$`));

  // Larry opens the group with their common ground: a Qloo bridge with "Why this?" naming whose picks led there.
  for (const p of [page, priyaPage]) {
    const larry = p.locator('[data-bubble="larry"]').first();
    await expect(larry).toContainText("I'm Larry, an AI pal", { timeout: 30_000 });
    await expect(p.getByRole("heading", { name: "Untitled Goose Game" })).toBeVisible();
    await expect(p.getByRole("button", { name: /Why this\?/ }).first()).toBeVisible();
  }
  // The QR is gone once the group is full; the header names the other person.
  await expect(page.getByRole("img", { name: "QR code to join this group" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Priya" })).toBeVisible();
  // One tap away in the header: Members, Leave, Unfriend, Block, Report. No read receipts or typing dots.
  await expect(priyaPage.getByRole("button", { name: "Members (2)" })).toBeVisible();
  for (const name of ["Leave", "Unfriend", "Block", "Report"]) {
    await expect(priyaPage.getByRole("button", { name, exact: true })).toBeVisible();
  }

  // Plain messages never wake Larry.
  await priyaPage.getByLabel(/Message from/).fill("Hi Sam! Board games this weekend?");
  await priyaPage.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Hi Sam! Board games this weekend?")).toBeVisible();
  await expect(page.locator('[data-bubble="larry"]')).toHaveCount(1);

  // @Larry -> Plan. The menu is a listbox (no row of command chips); picking sends "/plan".
  await expect(priyaPage.getByRole("button", { name: /^Ready to get out\?/ })).toHaveCount(0);
  await priyaPage.getByRole("button", { name: "@Larry", exact: true }).click();
  const menu = priyaPage.getByRole("listbox", { name: "Ask Larry" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option")).toHaveCount(10);
  await priyaPage.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(priyaPage.getByRole("button", { name: "@Larry", exact: true })).toBeFocused();
  // Escape closes the menu but keeps the @Larry tag on the message; its x takes it off.
  await priyaPage.getByRole("button", { name: "Remove the @Larry tag" }).click();
  await expect(priyaPage.getByRole("button", { name: "Remove the @Larry tag" })).toHaveCount(0);
  // Typing "/" opens it too; Enter picks. No location on this phone: Larry tells Priya alone,
  // warmly, with a one-tap "Share location". Sam never sees it.
  await priyaPage.getByLabel(/Message from/).fill("/pl");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await priyaPage.keyboard.press("Enter");
  await expect(priyaPage.getByText("/plan", { exact: true })).toBeVisible();
  await expect(priyaPage.getByText(/don't know roughly where you are/)).toBeVisible();
  await expect(priyaPage.getByRole("button", { name: "Share location" })).toBeVisible();
  await expect(page.getByText("/plan", { exact: true })).toBeVisible();
  await expect(page.locator('[data-bubble="larry"]').filter({ hasText: /where you are|Settings/ })).toHaveCount(0);

  // With a stored coarse point, the same command goes through, and Priya's point rides along with
  // her own request. The model and Qloo places never run in tests, so the ticket rides in on this answer.
  await priyaPage.route(`**/api/groups/${groupId}/messages`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { group: { planTicket?: PlanTicket }; messages: { from: string; planTicket?: PlanTicket; text: string }[] };
    const last = body.messages.findLast((m) => m.from === "larry");
    if (last) Object.assign(last, { text: "Here's a plan for you both.", planTicket: TICKET });
    body.group.planTicket = TICKET;
    await route.fulfill({ response: res, json: body });
  });
  await priyaPage.evaluate(() => localStorage.setItem("larry.location", JSON.stringify({ lat: 19.07, lon: 72.87, at: Date.now() })));
  const sent = priyaPage.waitForRequest((r) => r.url().endsWith(`/api/groups/${groupId}/messages`) && r.method() === "POST");
  await priyaPage.getByLabel(/Message from/).fill("/plan");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await priyaPage.keyboard.press("Enter");
  expect((await sent).postDataJSON().location).toEqual({ lat: 19.07, lon: 72.87 });
  await expect(priyaPage.getByRole("button", { name: "Share location" })).toHaveCount(0);
  await priyaPage.getByRole("button", { name: "See the plan: Dice and Tea Board Game Cafe" }).click();
  const ticket = priyaPage.getByRole("dialog", { name: "Your group plan" });
  await expect(ticket).toContainText("Dice and Tea Board Game Cafe");
  await expect(ticket.getByRole("button", { name: "I'm in" })).toBeVisible();
  await ticket.getByRole("button", { name: "Close" }).first().click();

  // Unfriend is silent and immediate: Priya's chat closes, and Sam's closes too.
  await priyaPage.getByRole("button", { name: "Unfriend", exact: true }).click();
  await priyaPage.getByRole("dialog", { name: "Unfriend Sam?" }).getByRole("button", { name: "Unfriend" }).click();
  await expect(priyaPage).toHaveURL(/\/group\?closed=unfriend$/);
  await expect(priyaPage.getByText("Done. They aren't told")).toBeVisible();
  // The chat is gone from Priya's list. Sam isn't told: Priya just isn't in his chat any more.
  await expect(priyaPage.getByRole("link", { name: /Sam/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Priya" })).toHaveCount(0, { timeout: 20_000 });
  // Nobody left to unfriend, block or report in his chat; Leave stays.
  await expect(page.getByRole("button", { name: "Unfriend", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave", exact: true })).toBeVisible();

  await page.request.delete("/api/account", { headers: sam.auth });
  await priyaPage.request.delete("/api/account", { headers: priya.auth });
  await other.close();
});

test("without an account, groups say so warmly and point to what still works on this phone", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await page.goto("/group/new");
  await expect(page.getByRole("heading", { level: 1, name: "Groups are for accounts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/signin?next=%2Fgroup%2Fnew");
  await expect(page.getByRole("link", { name: "Talk taste with Larry" }).first()).toBeVisible();
  // The rooms and pair session are gone.
  for (const path of ["/room", "/pair", "/join?c=x"]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(404);
  }
});
