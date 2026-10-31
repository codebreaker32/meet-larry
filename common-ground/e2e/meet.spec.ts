import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Persona } from "../src/lib/contracts";
import type { TasteItem } from "../src/lib/types";
import { expect, freshIp, guardModel, test } from "./fixtures";

// Open to meet with real browser contexts (one per phone). The server is real; the dev-only
// x-e2e-fake-qloo header makes any place id a public café (at E2E_VENUE in e2e-hooks.ts) for both
// Open to meet and check-ins, and skips Qloo bridges, so only people with 2+ picks in common are
// counted. Each phone is a signed-in 18+ account (fake e2e token, in-memory database) and checks in
// for real ("I'm here" = Arrive). Each phone's geolocation is set to the café, as the server checks
// presence. Picks are random per test, so blocks from one run never match people in another.

/** Same as E2E_VENUE_LOCATION in src/lib/rooms/e2e-hooks.ts (server-only, so not imported). */
const AT_CAFE = { latitude: 51.5072, longitude: -0.1276, accuracy: 20 };

const item = (name: string, domain: TasteItem["domain"] = "movie"): TasteItem => ({ id: randomUUID().toUpperCase(), name, domain });

function persona(name: string, likes: TasteItem[]): Persona {
  return { version: 1, name, likes, dislikes: [], notes: [], updatedAt: Date.now() };
}

interface Phone {
  context: BrowserContext;
  page: Page;
  /** The account's fake e2e uid. */
  uid: string;
  /** Every /api/meet/** response body this phone received. */
  meetBodies: string[];
}

/** Makes an 18+ account on the in-memory database and returns its uid. */
async function account(context: BrowserContext, name: string): Promise<string> {
  const uid = `meet-${randomUUID().slice(0, 12)}`;
  const auth = { authorization: `Bearer e2e:${uid}` };
  const { username } = (await (await context.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  const made = await context.request.post("/api/account", { data: { name, username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
  expect(made.status(), await made.text()).toBeLessThan(300);
  return uid;
}

async function phone(browser: Browser, baseURL: string, p: Persona, signedIn = true): Promise<Phone> {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-real-ip": freshIp(), "x-e2e-fake-qloo": "1" },
    reducedMotion: "reduce",
    geolocation: AT_CAFE,
    permissions: ["geolocation"],
  });
  await guardModel(context);
  const uid = signedIn ? await account(context, p.name) : "";
  await context.addInitScript(
    ([personaJson, accessCode, id]) => {
      if (sessionStorage.getItem("e2e.seeded")) return;
      sessionStorage.setItem("e2e.seeded", "1");
      localStorage.setItem("larry.persona", personaJson);
      localStorage.setItem("larry.location.choice", "on");
      if (accessCode) localStorage.setItem("larry.accessCode", accessCode);
      if (id) localStorage.setItem("larry.e2e.uid", id);
    },
    [JSON.stringify(p), process.env.E2E_CODE ?? "", uid] as const,
  );
  const page = await context.newPage();
  const meetBodies: string[] = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/meet")) return;
    meetBodies.push(await res.text().catch(() => ""));
  });
  return { context, page, uid, meetBodies };
}

async function switchOn(p: Page, placeId: string) {
  await p.goto(`/meet/${placeId}`);
  await expect(p.getByRole("heading", { level: 1, name: "Open to meet" })).toBeVisible();
  await expect(p.getByText("E2E Board Game Cafe").first()).toBeVisible();
  // "I'm here" is a real check-in (Arrive), then the 18+ switch.
  await p.getByRole("button", { name: "I'm here" }).click();
  // The exact entry others would see, and one tap that explains it.
  await expect(p.getByText(/A fellow .+ fan is in here somewhere\./)).toBeVisible();
  await p.getByRole("button", { name: "Could they tell which one is me?" }).click();
  await expect(p.getByText("No. It's one shared thing and a count, never a person.", { exact: false })).toBeVisible();
  const on = p.getByRole("button", { name: "Switch on Open to meet" });
  // 18+ is required: without the tick, nothing is switched on.
  await expect(on).toHaveAttribute("aria-disabled", "true");
  await on.click({ force: true });
  await expect(p.getByRole("alert").filter({ hasText: "Tick the box to say you are 18 or over." })).toBeVisible();
  await p.getByLabel("I am 18 or over.").check();
  await on.click();
  await expect(p.getByText("Open to meet is on")).toBeVisible();
}

test("Open to meet: 18+ opt-in on both phones, anonymous counts of shared interests only, mutual wave opens a room, block hides both ways", async ({
  browser,
}, testInfo) => {
  test.slow();
  const baseURL = String(testInfo.project.use.baseURL);
  const tag = randomUUID().slice(0, 6);
  const shared = item(`Shared Film ${tag}`);
  const shared2 = item(`Shared Band ${tag}`, "artist");
  const sam = await phone(browser, baseURL, persona("Samwise", [shared, shared2, item(`Sam Game ${tag}`, "videogame"), item(`Sam Book ${tag}`, "book")]));
  const priya = await phone(browser, baseURL, persona("Priyanka", [shared, shared2, item(`Priya Show ${tag}`, "tv_show"), item(`Priya Band ${tag}`, "artist")]));
  // Someone at the same place with only one pick in common (easy to fish for): never counted.
  const alex = await phone(browser, baseURL, persona("Alexandra", [shared, item(`Alex Film ${tag}`), item(`Alex Team ${tag}`, "sports_team")]));
  const placeId = `e2e-${randomUUID()}`;
  // A fresh device id per run, so the per-phone open limit never carries over between runs.
  const dev = `e2e-device-${randomUUID().slice(0, 12)}`;

  try {
    // The server refuses anyone without an account, or who hasn't confirmed 18+, whatever the page does.
    const signedOut = await sam.page.request.post(`/api/meet/${placeId}/open`, {
      data: { deviceId: dev, persona: { name: "X", likes: [shared] }, adult: true },
      headers: { "x-larry-code": process.env.E2E_CODE ?? "" },
    });
    expect(signedOut.status()).toBe(401);
    const refused = await sam.page.request.post(`/api/meet/${placeId}/open`, {
      data: { deviceId: dev, persona: { name: "X", likes: [shared] }, adult: false },
      headers: { "x-larry-code": process.env.E2E_CODE ?? "", authorization: `Bearer e2e:${sam.uid}` },
    });
    expect(refused.status()).toBe(400);
    // And anyone who hasn't checked in here.
    const noVisit = await sam.page.request.post(`/api/meet/${placeId}/open`, {
      data: { deviceId: dev, persona: { name: "X", likes: [shared, shared2] }, adult: true, where: { lat: 51.5072, lon: -0.1276, accuracy: 20 } },
      headers: { "x-larry-code": process.env.E2E_CODE ?? "", authorization: `Bearer e2e:${sam.uid}` },
    });
    expect(noVisit.status()).toBe(403);

    await switchOn(sam.page, placeId);
    await switchOn(priya.page, placeId);
    await switchOn(alex.page, placeId);

    // Each sees only an anonymous count under one shared thing, with no name.
    const samList = sam.page.getByRole("listitem").filter({ hasText: shared.name });
    await expect(samList).toHaveCount(1, { timeout: 30_000 });
    await expect(samList).toContainText(`Someone here likes ${shared.name} too.`);
    // Larry's line about the shared thing, grounded in it (the fixed line here: the model is guarded off).
    await expect(samList).toContainText(shared.name);
    const priyaList = priya.page.getByRole("listitem").filter({ hasText: shared.name });
    await expect(priyaList).toHaveCount(1, { timeout: 30_000 });
    // One thing per person: never a list of what else they picked.
    await expect(sam.page.getByText(shared2.name)).toHaveCount(0);
    await expect(sam.page.getByText("Priyanka")).toHaveCount(0);
    await expect(sam.page.getByText(`Priya Show ${tag}`)).toHaveCount(0);
    await expect(sam.page.getByText(`Alex Film ${tag}`)).toHaveCount(0);
    await expect(alex.page.getByText("Nobody here shares your taste yet.", { exact: false })).toBeVisible({ timeout: 30_000 });

    // A one-sided wave tells the other person nothing.
    await samList.getByRole("button", { name: "Wave" }).click();
    await expect(samList.getByText("You waved")).toBeVisible();
    await priya.page.waitForTimeout(500);
    await expect(priya.page.getByText(/waved at you/i)).toHaveCount(0);

    // Priya waves back: mutual, and a chat room opens with Larry in it.
    await priyaList.getByRole("button", { name: "Wave" }).click();
    await expect(priya.page).toHaveURL(/\/meet\/chat\/[A-Z0-9]{6}$/);
    await expect(priya.page.getByRole("heading", { level: 1, name: "You both waved" })).toBeVisible();
    await expect(priya.page.getByText("Meet only at E2E Board Game Cafe, in the public area.")).toBeVisible();
    // Larry opens the chat, labelled as an AI, naming what they share.
    const roomChat = priya.page.getByRole("region", { name: "Room chat" });
    await expect(roomChat.getByText("Larry (AI pal)").first()).toBeVisible();
    await expect(roomChat.getByText(new RegExp(shared.name)).first()).toBeVisible();
    // No invite code and no "Excuse Larry" in a meet room.
    await expect(priya.page.getByRole("button", { name: /Invite someone/ })).toHaveCount(0);
    await expect(priya.page.getByRole("button", { name: "Excuse Larry" })).toHaveCount(0);

    // Sam's phone picks up the chat on its next poll.
    await expect(sam.page.getByRole("link", { name: "Open the chat" }).first()).toBeVisible({ timeout: 30_000 });
    await sam.page.getByRole("link", { name: "Open the chat" }).first().click();
    await expect(sam.page.getByRole("heading", { level: 1, name: "You both waved" })).toBeVisible();

    // Block from inside the room: permanent, and both ways.
    await sam.page.getByRole("button", { name: "Block or report Priyanka" }).first().click();
    const sheet = sam.page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Keep yourself safe" })).toBeVisible();
    await sheet.getByRole("button", { name: "Block", exact: true }).click();
    await sheet.getByRole("button", { name: "Block Priyanka" }).click();
    await expect(sheet.getByText("Priyanka is blocked. You won't see each other again.")).toBeVisible();
    await sheet.getByRole("button", { name: "OK" }).click();

    // Back at the venue, neither phone lists the other any more.
    await sam.page.goto(`/meet/${placeId}`);
    await switchOnAgain(sam.page);
    await priya.page.goto(`/meet/${placeId}`);
    await switchOnAgain(priya.page);
    await expect(sam.page.getByText("Nobody here shares your taste yet.", { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(priya.page.getByText("Nobody here shares your taste yet.", { exact: false })).toBeVisible({ timeout: 30_000 });

    // No meet answer ever carried a name, a location or a time someone came.
    for (const [who, other] of [
      [sam, ["Priyanka", "Alexandra"]],
      [priya, ["Samwise", "Alexandra"]],
      [alex, ["Samwise", "Priyanka"]],
    ] as const) {
      expect(who.meetBodies.length).toBeGreaterThan(0);
      for (const body of who.meetBodies) {
        for (const name of other) expect(body).not.toContain(name);
        expect(body).not.toMatch(/"(lat|lon|lng|latitude|longitude|location|address|joinedAt|openedAt|lastSeen\w*)"/);
      }
    }
  } finally {
    await Promise.all([sam.context.close(), priya.context.close(), alex.context.close()]);
  }
});

/** After a check-in this visit, the page goes straight to the 18+ switch. */
async function switchOnAgain(p: Page) {
  await expect(p.getByRole("heading", { level: 1, name: "Open to meet" })).toBeVisible();
  const imHere = p.getByRole("button", { name: "I'm here" });
  if (await imHere.isVisible().catch(() => false)) await imHere.click();
  await p.getByLabel("I am 18 or over.").check();
  await p.getByRole("button", { name: "Switch on Open to meet" }).click();
  await expect(p.getByText("Open to meet is on")).toBeVisible();
}

test("Open to meet: signed out, it asks you to sign in, and never shows the switch", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const guest = await phone(browser, baseURL, persona("Guest", [item(`Guest Film ${randomUUID().slice(0, 6)}`)]), false);
  try {
    await guest.page.goto(`/meet/e2e-${randomUUID()}`);
    await expect(guest.page.getByRole("heading", { level: 1, name: "Open to meet is for members 18+" })).toBeVisible();
    await expect(guest.page.locator("#main").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /\/signin\?next=%2Fmeet%2F/);
    await expect(guest.page.getByRole("button", { name: "Switch on Open to meet" })).toHaveCount(0);
  } finally {
    await guest.context.close();
  }
});
