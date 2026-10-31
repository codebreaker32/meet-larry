// 1A review screenshots: the if-then Plan Ticket (Amazon hours, walking time, the little outing,
// Larry's opener, a worry with Larry's plan B, the guess and the stub with "I'm in"), the no-hours
// state, and the full-screen "Show this" card. Run: `npx tsx e2e/review-shots.ts 1a [job]`.
// Every model, Qloo and Amazon answer is mocked at the HTTP boundary.
import type { BrowserContext, Page } from "@playwright/test";
import type { PlaceCard, PlanTicket } from "../../src/lib/contracts";
import { DEMO_SAM as SAM } from "../../src/lib/demo";
import type { TicketExtras } from "../../src/lib/suggest-steps";
import type { ShotJob, ShotKit } from "./_kit";

const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" as const };
const CAFE: PlaceCard = {
  id: "E2E00000-0000-4000-8000-0000000000C1",
  name: "Dice & Tea Board Game Café",
  distanceKm: 0.6,
  tags: ["Board games", "Wi-Fi", "Quiet"],
  affinity: 0.9,
  vibe: "calm",
  slots: [],
  reason: "A café. Easy to sit and talk.",
  fits: [
    { who: "a", likely: "likes", why: "Board games and quiet corners, like Sam prefers." },
    { who: "b", likely: "maybe", why: "Priya likes cosy cafés, but weekends get busy." },
  ],
};
const TICKET: PlanTicket = { place: CAFE, when: "Sat 11am", item: { ...STARDEW }, opener: "Have you ever tried Stardew Valley?", rung: 0 };
const EXTRAS: TicketExtras = {
  hours: "Daily 10:30am-7:30pm",
  slots: ["Sat 11am", "Sun 11am", "Mon 5pm"],
  hoursFrom: "amazon",
  openNow: false,
  walkMin: 12,
  route: {
    stops: [
      { id: CAFE.id, name: CAFE.name, kind: "a café", vibe: "calm" },
      { id: "E2E00000-0000-4000-8000-0000000000C2", name: "Title Waves Books", kind: "a bookshop", vibe: "calm" },
    ],
    walks: [6],
    line: `Tea and a game at ${CAFE.name} first, then a 6 minute stroll to Title Waves Books, then a slow walk.`,
    fromLarry: true,
  },
  opener: "Which crop do you always plant first in Stardew Valley?",
  fallback: false,
};

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const done = (result: Record<string, unknown>) => ({ type: "done", result: { quiet: false, steps: [], profileUpdates: [], ...result } });

async function ticketPage(kit: ShotKit, w: number, extras: TicketExtras | null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await kit.context(w, { "cg.profile": JSON.stringify(SAM) });
  const page = await ctx.newPage();
  await page.route("**/api/suggest", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}") as { kind?: string };
    if (body.kind === "ticket") return extras ? r.fulfill({ contentType: "application/json", body: JSON.stringify(extras) }) : r.fulfill({ status: 500, body: "{}" });
    if (body.kind === "plan_b")
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ planB: `If I want to go, I'll say "Got to feed my Stardew chickens" and head off. That counts.`, fallback: false }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ steps: [], nudges: [], fallback: false }) });
  });
  await page.route("**/api/common-ground", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ shared: [], bridges: [], domains: [] }) }));
  // The one-phone pair chat is retired: the ticket opens from the solo chat with Larry.
  let n = 0;
  await page.route("**/api/larry", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([
        n++ === 0
          ? done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI pal." }] })
          : done({ messages: [{ from: "larry", text: "Here's a plan for you." }], places: [CAFE], planTicket: TICKET }),
      ]),
    }),
  );
  await page.goto("/larry");
  await page.getByText("Hi Sam, I'm Larry, an AI pal.").first().waitFor();
  const box = page.getByRole("textbox", { name: /Message from/ });
  await box.fill("Can you plan something for us?");
  await box.press("Enter");
  await page.getByText("Here's a plan for you.").first().waitFor();
  await page.getByRole("button", { name: "See the plan" }).click();
  await page.getByRole("region", { name: "Your plan" }).waitFor();
  return { ctx, page };
}

async function ticket(kit: ShotKit, w: number) {
  const { ctx, page } = await ticketPage(kit, w, EXTRAS);
  const plan = page.getByRole("region", { name: "Your plan" });
  await plan.getByText("About a 12 min walk from you").waitFor();
  await kit.shot(page, "ticket-top", w);
  await plan.getByRole("button", { name: "Add it to my plan" }).click();
  await plan.getByRole("button", { name: "I'll want to leave" }).click();
  await plan.getByText("Got to feed my Stardew chickens").waitFor();
  await plan.getByRole("radio", { name: "Good" }).click();
  await plan.getByRole("radio", { name: "Good" }).scrollIntoViewIfNeeded();
  await kit.shot(page, "ticket-stub", w);
  await plan.getByRole("button", { name: "I'm in" }).click();
  await page.getByRole("heading", { name: /You're in/ }).waitFor();
  await kit.shot(page, "ticket-in", w);
  await ctx.close();
}

async function noHours(kit: ShotKit, w: number) {
  const { ctx, page } = await ticketPage(kit, w, null);
  const plan = page.getByRole("region", { name: "Your plan" });
  await plan.getByText("Check before you go.", { exact: false }).waitFor();
  await plan.getByRole("heading", { name: "When" }).scrollIntoViewIfNeeded();
  await kit.shot(page, "ticket-no-hours", w);
  await plan.getByRole("button", { name: "Show it instead" }).click();
  await page.getByRole("dialog", { name: "Show this" }).waitFor();
  await kit.shot(page, "opener-card", w);
  await ctx.close();
}

export const jobs: ShotJob[] = [
  { name: "ticket", run: ticket },
  { name: "no-hours", run: noHours },
];
