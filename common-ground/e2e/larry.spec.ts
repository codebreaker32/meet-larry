import type { GroupChatResult } from "../src/lib/contracts";
import type { LarryEvent } from "../src/lib/types";
import { expect, SUGGEST_NUDGES, SUGGEST_STEPS, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { PLACES, SAM, seedStorage } from "./helpers";

/** D24: the coarse point the one onboarding ask stored (no "share location" button anywhere else). */
async function seedLocation(page: Page, lat = 12.97, lon = 77.59) {
  await page.addInitScript(
    ([la, lo]) => {
      localStorage.setItem("larry.location", JSON.stringify({ lat: la, lon: lo, at: Date.now() }));
      localStorage.setItem("larry.location.choice", "on");
    },
    [lat, lon] as const,
  );
}

// Solo "Chat with Larry": short, honest, grounded, and it ends by pointing to real people.
// /api/larry is answered here as an NDJSON stream, so no model call is made.

const OPENER = "Hi Sam, I'm Larry, an AI that finds things you might like from real taste data. Films or games?";
const GAMES = "Fans of Minecraft also like Stardew Valley. Want somewhere calm to play nearby?";
const WRAP = "Thanks for chatting, Sam. I saved a First Step for you.";
const STEP = "Find someone who also likes Minecraft";

const done = (r: Partial<GroupChatResult>): LarryEvent => ({
  type: "done",
  result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...r },
});

test("solo chat with Larry: an AI label, Qloo picks with reasons, venue cards, and a wrap-up that points to a group", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await seedLocation(page);
  await seedStorage(page, { profile: SAM });
  const requests: {
    history: { role: string; content: string }[];
    location?: unknown;
    stepsDone?: number;
    profile: { name: string };
    signals?: Record<string, unknown>;
  }[] = [];
  await page.route("**/api/larry", async (route) => {
    const req = JSON.parse(route.request().postData() ?? "{}");
    const n = requests.length;
    requests.push(req);
    const events: LarryEvent[] =
      n === 0
        ? [done({ messages: [{ from: "larry", text: OPENER }] })]
        : n === 1
          ? [
              { type: "progress", tool: "recommend", text: "Larry is looking for games you might love…" },
              done({ messages: [{ from: "larry", text: GAMES }], places: PLACES }),
            ]
          : [done({ messages: [{ from: "larry", text: WRAP }], steps: [{ kind: "say", text: STEP }], wrapUp: true })];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  });

  await page.goto("/larry");
  await expect(page.getByRole("heading", { level: 1, name: "Talk taste with Larry" })).toBeVisible();
  await expect(page.getByText("Larry is an AI, not a person.", { exact: false })).toBeVisible();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat.getByText(OPENER)).toBeVisible();
  await expect(chat.getByText("Larry (AI pal)").first()).toBeVisible();
  // Larry's mascot sits next to its messages, with words for screen readers, and has really loaded.
  const avatar = chat.getByRole("img", { name: "Larry, an AI pal" }).first();
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(requests[0]).toMatchObject({ history: [], profile: { name: "Sam" } });

  // D24: no "share location" button; the stored point goes with the request.
  await expect(page.getByRole("button", { name: /share location/i })).toHaveCount(0);
  expect(requests[0].location).toEqual({ lat: 12.97, lon: 77.59 });
  expect(requests[0].signals).toBeUndefined();

  // Mood and Hidden Gems: one tap each, sent with this person's next request.
  await page.getByRole("button", { name: "Pick a mood" }).click();
  await page.getByRole("button", { name: "Chill", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mood: Chill" })).toBeVisible();
  // Hidden Gems sits behind "More options" (closed by default).
  await page.getByRole("button", { name: /^More options/ }).click();
  const gems = page.getByRole("switch", { name: /Hidden gems only/ });
  await gems.click();
  await expect(gems).toHaveAttribute("aria-checked", "true");

  // One tap asks, no typing needed.
  await page.getByRole("button", { name: "Games", exact: true }).click();
  await expect(chat.getByText(GAMES)).toBeVisible();
  expect(requests[1].history.at(-1)).toEqual({ role: "user", content: "[Sam] Games" });
  expect(requests[1].location).toEqual({ lat: 12.97, lon: 77.59 });
  expect(requests[1].signals).toEqual({ mood: "chill", hiddenGems: true });

  // Places come back as venue cards, each with one tap to plan it.
  const venues = page.getByRole("list", { name: "Places nearby, found by Larry" });
  await expect(venues.getByRole("heading", { name: PLACES[0].name })).toBeVisible();
  await expect(venues.getByText(PLACES[0].reason!)).toBeVisible();
  // "Plan this" turns the place into a Plan Ticket; "Keep talking" goes back to the chat.
  await venues.getByRole("button", { name: `Plan this: ${PLACES[0].name}` }).click();
  const plan = page.getByRole("region", { name: "Your plan" });
  await expect(plan.getByRole("heading", { name: PLACES[0].name })).toBeVisible();
  await plan.getByRole("button", { name: "Keep talking" }).click();
  await expect(plan).toHaveCount(0);

  // A short warm nudge (AI-written per session; mocked here), never a countdown.
  await expect(page.getByText(new RegExp(`^(${SUGGEST_NUDGES.map((n) => n.replace(/\./g, "\\.")).join("|")})$`))).toBeVisible();
  await expect(page.getByText(/messages left|practice round is/)).toHaveCount(0);

  // The last turn wraps up: a real First Step and a way to real people, and the chat stops.
  const box = page.getByRole("textbox", { name: "Message from Sam" });
  await box.fill("Can we keep chatting all night?");
  await box.press("Enter");
  await expect(chat.getByText(WRAP)).toBeVisible();
  // The chat ends on the plan; "Other ideas" shows the First Steps and the way to a group.
  await expect(plan).toBeVisible();
  await expect(plan.getByRole("button", { name: "Keep talking" })).toHaveCount(0);
  await plan.getByRole("button", { name: "Other ideas" }).click();
  const panel = page.getByRole("region", { name: "Save a First Step" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("That's our chat for now, Sam.");
  await expect(panel.getByRole("link", { name: "Start a group" })).toHaveAttribute("href", "/group/new");
  await expect(panel.getByRole("button", { name: new RegExp(STEP) })).toBeVisible();
  await expect(panel.getByRole("button", { name: new RegExp(SUGGEST_STEPS[0].text) })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep talking" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message from Sam" })).toHaveCount(0);

  // Larry said the step was saved, so it already is.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as { text: string }[]);
  expect(saved.map((s) => s.text)).toContain(STEP);
  expect(requests).toHaveLength(3);
});

test("solo chat: crisis words get the fixed help reply on the device, with no call to Larry", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  let calls = 0;
  await page.route("**/api/larry", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: JSON.stringify(done({ messages: [{ from: "larry", text: OPENER }] })) + "\n",
    });
  });
  await page.goto("/larry");
  await expect(page.getByRole("region", { name: "Chat" }).getByText(OPENER)).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message from Sam" });
  await box.fill("I want to die");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "See helplines" })).toBeVisible();
  expect(calls).toBe(1);
});

test("First Steps: the ladder's 'Ask Larry for a calm place' goes through Larry, with the location", async ({ page }) => {
  await seedLocation(page);
  await seedStorage(page, { profile: SAM });
  const requests: { history: { role: string; content: string }[]; location?: unknown }[] = [];
  const PICK = `Hi Sam, I'm Larry, an AI. ${PLACES[0].name} is close and calm. I saved a short visit as your First Step.`;
  await page.route("**/api/larry", async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? "{}"));
    const events: LarryEvent[] = [
      { type: "progress", tool: "find_places_nearby", text: "Looking for calm places near you…" },
      done({ messages: [{ from: "larry", text: PICK }], places: PLACES, steps: [{ kind: "go", text: `Spend 10 minutes at ${PLACES[0].name}` }] }),
    ];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  });

  await page.goto("/steps");
  // No plain list of places on First Steps: one button that asks Larry.
  await expect(page.getByRole("button", { name: "Find places near me" })).toHaveCount(0);
  // The ladder's empty rung asks Larry for a place on that rung.
  await page.getByRole("link", { name: "Ask Larry for a calm place" }).click();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat.getByText(PICK)).toBeVisible();
  // The ask is used once: a reload starts a normal chat.
  await expect(page).toHaveURL(/\/larry$/);
  expect(requests).toHaveLength(1);
  expect(requests[0].history).toHaveLength(1);
  expect(requests[0].history[0].content).toMatch(/^\[Sam\] Find me one calm place nearby for my next step on the ladder/);
  expect(requests[0].location).toEqual({ lat: 12.97, lon: 77.59 });
  await expect(page.getByRole("list", { name: "Places nearby, found by Larry" }).getByRole("heading", { name: PLACES[0].name })).toBeVisible();
  await expect(chat.getByText(`First Step: Spend 10 minutes at ${PLACES[0].name}`)).toBeVisible();
});

test("solo chat with no stored location: one plain line to Settings, never a share button", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await page.route("**/api/larry", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(done({ messages: [{ from: "larry", text: OPENER }] })) + "\n" }),
  );
  await page.goto("/larry");
  await expect(page.getByRole("region", { name: "Chat" }).getByText(OPENER)).toBeVisible();
  const off = page.getByRole("link", { name: "Places near you are off. Turn on in Your taste > Settings." }).first();
  await expect(off).toHaveAttribute("href", "/me#settings");
  await expect(page.getByRole("button", { name: /share location/i })).toHaveCount(0);
});

test("composer mic: unsupported browsers get a tip, never a silent gap", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await seedStorage(page, { profile: SAM });
  await page.route("**/api/larry", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(done({ messages: [{ from: "larry", text: OPENER }] })) + "\n" }),
  );
  await page.goto("/larry");
  await expect(page.getByText("Open in Chrome or Safari to use the mic.")).toBeVisible();
});

test("composer mic: keeps listening until stop, shows live words, never sends, English (India) or Hindi", async ({ page }) => {
  // A fake browser recogniser: the test drives its results and ends.
  await page.addInitScript(() => {
    type Handler = ((e: unknown) => void) | null;
    class FakeRec {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: Handler = null;
      onend: (() => void) | null = null;
      onerror: Handler = null;
      start() {
        (window as unknown as { __rec: FakeRec; __starts: string[] }).__rec = this;
        const w = window as unknown as { __starts?: string[] };
        w.__starts = [...(w.__starts ?? []), this.lang];
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    // Newer Chromium has the unprefixed name too, so both point at the fake.
    Object.assign(window, { SpeechRecognition: FakeRec, webkitSpeechRecognition: FakeRec });
  });
  await seedStorage(page, { profile: SAM });
  let calls = 0;
  await page.route("**/api/larry", (route) => {
    calls++;
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(done({ messages: [{ from: "larry", text: OPENER }] })) + "\n" });
  });
  await page.goto("/larry");
  await expect(page.getByRole("region", { name: "Chat" }).getByText(OPENER)).toBeVisible();
  await page.getByRole("button", { name: "Speak instead of typing" }).click();
  await expect(page.getByText("Listening to Sam. Tap stop when you are done.")).toBeVisible();
  await expect(page.getByText("Your browser turns speech into text (Google in Chrome, Apple in Safari).")).toBeVisible();
  const say = (text: string, isFinal: boolean) =>
    page.evaluate(
      ([t, f]) => {
        const rec = (window as unknown as { __rec: { onresult: (e: unknown) => void } }).__rec;
        rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: f })] });
      },
      [text, isFinal] as const,
    );
  const box = page.getByRole("textbox", { name: "Message from Sam" });
  await say("I like", false);
  await expect(box).toHaveValue("I like");
  await say("I like board games", true);
  // The browser's own silence cut-off: it listens on instead of stopping.
  await page.evaluate(() => (window as unknown as { __rec: { onend: () => void } }).__rec.onend());
  await expect(page.getByRole("button", { name: "Stop listening" })).toBeVisible();
  // Hindi carries on in the new language, keeping the words heard.
  await page.getByRole("group", { name: "Mic language" }).getByRole("button", { name: "Hindi" }).click();
  await expect(page.getByRole("button", { name: "Hindi" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as unknown as { __starts: string[] }).__starts.at(-1))).toBe("hi-IN");
  await say("aur chai", true);
  await expect(box).toHaveValue("I like board games aur chai");
  await page.getByRole("button", { name: "Stop listening" }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  // Nothing was sent by the mic: only Larry's opening call.
  expect(calls).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("larry.speechLang") ?? "null"))).toBe("hi-IN");
});
