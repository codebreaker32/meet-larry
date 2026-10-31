import type { Page } from "@playwright/test";
import type { PlaceCard, PlanTicket } from "../src/lib/contracts";
import type { TicketExtras } from "../src/lib/suggest-steps";
import { expect, test } from "./fixtures";
import { done, mockCommonGround, SAM, seedStorage } from "./helpers";

// The if-then Plan Ticket (1A): a real day and time even without Qloo hours, the walking time, a
// second stop in walking order, Larry's opener, six worries, the weekly guess and "I'm in".
// Every model, Qloo and Amazon answer is mocked at the HTTP boundary.

const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" as const };

const CAFE: PlaceCard = {
  id: "E2E00000-0000-4000-8000-0000000000C1",
  name: "Dice & Tea Board Game Café",
  distanceKm: 0.6,
  tags: ["Board games", "Wi-Fi"],
  affinity: 0.9,
  vibe: "calm",
  // No hours from Qloo: Amazon fills them in (mocked below), or the ticket says to check first.
  slots: [],
  reason: "A café. Easy to sit and talk.",
  fits: [
    { who: "a", likely: "likes", why: "board games, and it's quiet" },
    { who: "b", likely: "maybe", why: "it can get busy at weekends" },
  ],
};

const TICKET: PlanTicket = {
  place: CAFE,
  when: "Sat 11am",
  item: { ...STARDEW },
  // A plain template: Larry replaces it.
  opener: "Have you ever tried Stardew Valley?",
  rung: 0,
};

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

async function openTicket(page: Page, extras: TicketExtras | "fail") {
  await seedStorage(page, { profile: SAM });
  await mockCommonGround(page);
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/suggest", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    asked.push(body);
    if (body.kind === "ticket") {
      if (extras === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(extras) });
    }
    if (body.kind === "plan_b" && body.obstacle === "leave") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ planB: `If I want to go, I'll say "Got to feed my Stardew chickens" and head off. That counts.`, fallback: false }),
      });
    }
    return route.fallback();
  });
  // The one-phone pair chat is retired: the ticket opens from the solo chat with Larry.
  let n = 0;
  await page.route("**/api/larry", async (route) => {
    const events =
      n++ === 0
        ? [done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI pal." }] })]
        : [done({ messages: [{ from: "larry", text: "Here's a plan for you." }], places: [CAFE], planTicket: TICKET })];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  });
  await page.goto("/larry");
  await expect(page.getByText("Hi Sam, I'm Larry, an AI pal.").first()).toBeVisible();
  const box = page.getByRole("textbox", { name: /Message from/ });
  await box.fill("Can you plan something for us?");
  await box.press("Enter");
  await expect(page.getByText("Here's a plan for you.").first()).toBeVisible();
  await page.getByRole("button", { name: "See the plan" }).click();
  const plan = page.getByRole("region", { name: "Your plan" });
  await expect(plan).toBeVisible();
  return { plan, asked };
}

test("the if-then ticket: Amazon hours, walking time, a second stop, Larry's opener, a new worry, the guess and I'm in", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("larry.guessWeek"));
  const { plan, asked } = await openTicket(page, EXTRAS);

  // Larry filled the ticket in: the request carried only the place, the item and the opener.
  await expect(plan.getByText("About a 12 min walk from you")).toBeVisible();
  const ticketAsk = asked.find((b) => b.kind === "ticket")!;
  expect(ticketAsk).toMatchObject({ place: { id: CAFE.id, name: CAFE.name }, item: { id: STARDEW.id }, opener: TICKET.opener });
  await expect(plan.getByText("Hours: Daily 10:30am-7:30pm (from Amazon Location)")).toBeVisible();
  await expect(plan.getByRole("button", { name: "Sat 11am" })).toHaveAttribute("aria-pressed", "true");
  await expect(plan.getByTestId("ticket-hours-note")).toHaveText("Daytime only, when it's open. Check the hours again before you go.");
  await expect(plan.getByTestId("ticket-opener")).toHaveText(EXTRAS.opener!);

  // The if-then line, live: it changes with the time chip.
  const stub = plan.getByTestId("ticket-stub");
  await expect(stub).toContainText(`If it's Sat 11am, then I walk to ${CAFE.name} and say: "${EXTRAS.opener}"`);
  await plan.getByRole("button", { name: "Sun 11am" }).click();
  await expect(stub).toContainText("If it's Sun 11am, then I walk to");

  // The little outing, in walking order, joins the line when added.
  await expect(plan.getByText(EXTRAS.route!.line)).toBeVisible();
  await plan.getByRole("button", { name: "Add it to my plan" }).click();
  await expect(plan.getByRole("button", { name: "Added to my plan" })).toHaveAttribute("aria-pressed", "true");
  await expect(stub).toContainText("Then I walk 6 min to Title Waves Books.");

  // A new worry: Larry writes the "then".
  await plan.getByRole("button", { name: "I'll want to leave" }).click();
  await expect(plan.getByRole("status")).toContainText("Got to feed my Stardew chickens");
  await expect(plan.getByRole("status")).toContainText("Plan B from Larry.");

  // The optional guess, then I'm in.
  await plan.getByRole("radio", { name: "Good" }).click();
  await plan.getByRole("button", { name: "I'm in" }).click();
  await expect(page.getByRole("heading", { name: /^You're in/ })).toBeVisible();
  const saved = await page.evaluate(() => ({
    steps: JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as Record<string, unknown>[],
    week: localStorage.getItem("larry.guessWeek"),
  }));
  expect(saved.steps.at(-1)).toMatchObject({ kind: "go", placeId: CAFE.id, when: "Sun 11am", guess: 4, obstacle: "leave" });
  expect(String(saved.steps.at(-1)!.ifThen)).toContain("Then I walk 6 min to Title Waves Books.");
  expect(String(saved.steps.at(-1)!.ticketId).length).toBeGreaterThan(8);
  expect(saved.week).toMatch(/^"?\d{4}-W\d{2}"?$/);
});

test("with no hours anywhere, the ticket still names a day and time and says to check first; Show this goes full screen", async ({ page }) => {
  const { plan } = await openTicket(page, "fail");
  await expect(plan.getByTestId("ticket-hours-note")).toHaveText("We don't know its hours yet, so this is a good daytime guess. Check before you go.");
  const first = plan.getByRole("group", { name: "When" }).getByRole("button").first();
  await expect(first).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(am|pm)$/);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  // The template opener stays when Larry could not write a new one; six worries are offered.
  await expect(plan.getByTestId("ticket-opener")).toHaveText(TICKET.opener);
  for (const w of ["I feel nervous", "I don't know what to say", "No one to go with", "I can't get there", "It might be too loud", "I'll want to leave"]) {
    await expect(plan.getByRole("button", { name: w })).toBeVisible();
  }

  await plan.getByRole("button", { name: "Show it instead" }).click();
  const show = page.getByRole("dialog", { name: "Show this" });
  await expect(show).toBeVisible();
  await expect(show).toContainText(TICKET.opener);
  const box = await show.boundingBox();
  const vp = page.viewportSize()!;
  expect(Math.round(box!.width)).toBe(vp.width);
  await page.keyboard.press("Escape");
  await expect(show).toBeHidden();
  await expect(plan.getByRole("button", { name: "Show it instead" })).toBeFocused();
});
