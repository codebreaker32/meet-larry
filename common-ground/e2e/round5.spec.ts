import type { GroupChatResult, PlaceCard, PlanTicket } from "../src/lib/contracts";
import type { FirstStep, LarryEvent } from "../src/lib/types";
import { expect, test } from "./fixtures";
import { SAM, seedStorage } from "./helpers";

// Round 5: the persona that learns, Plan Tickets, place cards with fits and vibe, the ladder and
// private milestones. Every model call is mocked at the HTTP boundary.

const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" as const };

const CAFE: PlaceCard = {
  id: "E2E00000-0000-4000-8000-0000000000C1",
  name: "Dice & Tea Board Game Café",
  distanceKm: 0.6,
  tags: ["Board games", "Wi-Fi"],
  affinity: 0.9,
  vibe: "calm",
  hours: "Mon-Sun 10am-8pm",
  slots: ["Sat 11am", "Sun 2pm"],
  reason: "A board-game café. Easy to sit and play.",
  fits: [],
};

const ticketFor = (place: PlaceCard): PlanTicket => ({
  place,
  when: "Sat 11am",
  item: { ...STARDEW },
  opener: "Have you played Stardew Valley? I keep restarting my farm.",
  planB: "If it's too busy, we'll walk to the bookshop next door.",
  rung: 0,
});

const larryDone = (r: Partial<GroupChatResult> & Record<string, unknown>): LarryEvent =>
  ({ type: "done", result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...r } }) as LarryEvent;

test("Talk taste with Larry learns the persona (shown on /me), shows place cards with fit and vibe, and ends on a Plan Ticket", async ({
  page,
}) => {
  await seedStorage(page, { profile: SAM });
  const requests: { persona?: { likes: { name: string }[] } }[] = [];
  const card: PlaceCard = { ...CAFE, fits: [{ who: "me", likely: "likes", why: "board games, and it's quiet" }] };
  await page.route("**/api/larry", async (route) => {
    const req = JSON.parse(route.request().postData() ?? "{}");
    const n = requests.length;
    requests.push(req);
    const events =
      n === 0
        ? [larryDone({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. What have you been playing?" }] })]
        : [
            larryDone({
              messages: [{ from: "larry", text: "Stardew Valley fans like this calm café. I made you a plan." }],
              places: [card],
              planTicket: ticketFor(card),
              personaUpdate: {
                addLikes: [STARDEW],
                addDislikes: [{ name: "Horror films" }],
                addNotes: ["plays cricket"],
                placeVibe: "calm",
              },
            }),
          ];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" });
  });

  await page.goto("/larry");
  await expect(page.getByRole("heading", { level: 1, name: "Talk taste with Larry" })).toBeVisible();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat.getByText("What have you been playing?")).toBeVisible();
  // The persona goes with the request (the whole saved card).
  expect(requests[0].persona?.likes.map((l) => l.name)).toEqual(SAM.items.map((i) => i.name));

  const box = page.getByRole("textbox", { name: "Message from Sam" });
  await box.fill("Stardew mostly. I don't like horror films. I play cricket.");
  await box.press("Enter");

  // "Larry learned": plain lines, with Undo.
  await expect(chat.getByText("Larry learned:")).toBeVisible();
  await expect(chat.getByText("You like Stardew Valley.")).toBeVisible();
  await expect(chat.getByText("You don't enjoy Horror films.")).toBeVisible();
  await expect(chat.getByText("Plays cricket.")).toBeVisible();

  // The place card: vibe tag, plain tags, hours, and why it fits this person.
  const places = page.getByRole("list", { name: "Places nearby, found by Larry" });
  await expect(places.getByRole("heading", { name: CAFE.name })).toBeVisible();
  await expect(places.getByText("Calm", { exact: true })).toBeVisible();
  await expect(places.getByText(/^Board games/)).toBeVisible();
  await expect(places.getByText(CAFE.hours!)).toBeVisible();
  await expect(places.getByText("board games, and it's quiet")).toBeVisible();
  // Open to meet is for signed-in members only (accounts are 18+); this phone has no account.
  await expect(places.getByRole("link", { name: "Open to meet here" })).toHaveCount(0);

  // Larry's plan: a real place, a daytime slot, the thing to bring up, the line to say.
  await chat.getByRole("button", { name: "See the plan" }).click();
  const plan = page.getByRole("region", { name: "Your plan" });
  await expect(plan).toBeVisible();
  // Focus moves to the plan, so keyboard and screen-reader users land on it.
  await expect(plan.getByRole("heading", { name: "Your plan" })).toBeFocused();
  // "Keep talking" closes it and gives focus back to the button that opened it.
  await plan.getByRole("button", { name: "Keep talking" }).click();
  await expect(chat.getByRole("button", { name: "See the plan" })).toBeFocused();
  await chat.getByRole("button", { name: "See the plan" }).click();
  await expect(plan.getByRole("heading", { name: "Your plan" })).toBeFocused();
  await expect(plan.getByText("Larry (an AI) picked this real place")).toBeVisible();
  await expect(plan.getByRole("button", { name: "Sat 11am" })).toHaveAttribute("aria-pressed", "true");
  await expect(plan.getByTestId("ticket-opener")).toContainText(ticketFor(card).opener);
  await plan.getByRole("button", { name: "I'm in" }).click();
  await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
  const steps = await page.evaluate(() => JSON.parse(localStorage.getItem("cg.steps") ?? "[]") as (FirstStep & { placeId?: string })[]);
  expect(steps.at(-1)).toMatchObject({ kind: "go", placeId: CAFE.id });

  // /me shows what Larry learned, on this phone only.
  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1, name: "Your taste, by Larry" })).toBeVisible();
  await expect(page.getByText(/If you sign in, it syncs to your account/)).toBeVisible();
  await expect(page.getByRole("region", { name: "What you like" }).getByText("Stardew Valley")).toBeVisible();
  await expect(page.getByRole("region", { name: "Not for you" }).getByText("Horror films")).toBeVisible();
  await expect(page.getByRole("region", { name: "Larry's notes" }).getByText("plays cricket")).toBeVisible();
  await expect(page.getByRole("region", { name: "Places you like" }).getByRole("button", { name: "Calm" })).toHaveAttribute("aria-pressed", "true");
});

test("the ladder shows calm to lively with your rung, and check-in stages stay private on this phone", async ({ page }) => {
  const now = Date.now();
  const planned = {
    id: "plan1",
    kind: "go",
    text: `Go to ${CAFE.name}, Sat 11am. Bring up Stardew Valley.`,
    createdAt: now - 60_000,
    done: false,
    placeId: CAFE.id,
    placeName: CAFE.name,
    vibe: "calm",
    opener: "Have you played Stardew Valley?",
    planB: "If it's too busy, I'll come back on a weekday.",
  } as FirstStep;
  await seedStorage(page, { profile: SAM, steps: [planned] });
  // Three verified visits already folded into a private counter: "Regular". An adult range, so the
  // Open to meet entry may show (it is hidden for 13-17s and unknown ages).
  await page.addInitScript(
    ([id, name]) => {
      localStorage.setItem("larry.ageBucket", JSON.stringify("25-34"));
      if (localStorage.getItem("larry.places")) return;
      localStorage.setItem(
        "larry.places",
        JSON.stringify([{ placeId: id, placeName: name, visits: 3, weeksBits: "111", totalWeeks: 3, lastIsoWeek: "2026-W44", stage: "regular", spotWeeks: 3 }]),
      );
    },
    [CAFE.id, CAFE.name] as const,
  );
  // Arrive is checked on the server (one fix within 150 m); mocked here.
  await page.route("**/api/checkins/arrive", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ visitToken: "x".repeat(20), dwellMs: 1_200_000 }) }),
  );
  const sent: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/") || r.url().includes("/api/checkins/")) return;
    // recentPlaces carries the ids of saved plans (never visits), so Larry can pick fresh places.
    let body = r.postData() ?? "";
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      delete json.recentPlaces;
      body = JSON.stringify(json);
    } catch {}
    sent.push(`${r.url()} ${body}`);
  });

  await page.goto("/steps");
  const ladder = page.getByRole("region", { name: "Quiet to lively" });
  await expect(ladder).toBeVisible();
  await expect(ladder.getByRole("heading", { name: /^Calm/ })).toBeVisible();
  await expect(ladder.getByRole("heading", { name: /^Cosy/ })).toBeVisible();
  await expect(ladder.getByRole("heading", { name: /^Lively/ })).toBeVisible();
  await expect(ladder.locator('[aria-current="step"]')).toContainText("Calm");
  await expect(ladder.locator('[aria-current="step"]')).toContainText("You are here");
  // An empty rung asks Larry for a place on that rung.
  await expect(ladder.getByRole("link", { name: "Ask Larry for a lively place" })).toHaveAttribute("href", "/larry?ask=place&vibe=lively");

  // The planned step shows the line to say and plan B, and "I'm here" opens the verified check-in.
  await expect(page.getByText("Your line: Have you played Stardew Valley?")).toBeVisible();
  await page.getByRole("button", { name: `I'm here: ${CAFE.name}` }).first().click();
  const sheet = page.getByRole("region", { name: `Check in at ${CAFE.name}` });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "I'm here", exact: true }).click();
  const here = page.getByRole("region", { name: `You're at ${CAFE.name}. Enjoy it.` });
  await expect(here).toBeVisible();
  await expect(here.getByRole("link", { name: "Open to meet here" })).toHaveAttribute("href", `/meet/${encodeURIComponent(CAFE.id)}`);

  // Your places: the private stamp.
  const mine = page.getByRole("region", { name: "Your places" });
  await expect(mine.getByText("Only you see this. We keep counts, not a diary.")).toBeVisible();
  await expect(mine.getByText("Regular", { exact: true })).toBeVisible();

  // Nothing about stages ever left the phone (only the check-in routes see the place, to verify it).
  for (const line of sent) {
    expect(line).not.toContain(CAFE.id);
    expect(line).not.toMatch(/checkin|milestone|regular/i);
  }
});

test("after a place step, the private check-in asks why, Larry picks the next rung from real places, and learns", async ({ page }) => {
  const now = Date.now();
  const done = (id: string, name: string, vibe: "calm" | "cosy" | "lively", extra: Partial<FirstStep> = {}) =>
    ({ id, kind: "go", text: `Go to ${name}, Sat 11am.`, createdAt: now - 60_000, done: false, placeId: `E2E-${id}`, placeName: name, vibe, ...extra }) as FirstStep;
  // A cosy place to finish now, and a calm one already planned (so the ladder knows a real calm place).
  await seedStorage(page, { profile: SAM, steps: [done("cosy1", "Dice & Tea Board Game Café", "cosy"), done("calm1", "Title Waves Books", "calm")] });
  const asked: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/suggest")) asked.push(JSON.parse(r.postData() ?? "{}"));
  });

  await page.goto("/steps");
  await page.getByRole("button", { name: "I did it: Go to Dice & Tea Board Game Café, Sat 11am." }).click();
  await page.getByRole("region", { name: "Nice one. How was it?" }).getByRole("button", { name: "Easy" }).click();
  const card = page.getByRole("region", { name: "Easy. Great." });
  // One more tap: why. Larry picks the next place with it.
  const reasons = card.getByRole("group", { name: /What made it easy/ });
  await expect(reasons.getByRole("button")).toHaveText(["Too loud", "Didn't know anyone", "Couldn't find it", "Loved it", "Skip"]);
  await reasons.getByRole("button", { name: "Too loud" }).click();

  await expect(card).toContainText("Larry: Title Waves Books is quieter, with corners to sit and read.");
  await expect(card).toContainText("Larry learned:");
  await expect(card).toContainText("You like calm, quiet places.");
  await card.getByRole("button", { name: "Save this step" }).click();
  await expect(card.getByRole("status")).toHaveText("Saved to your First Steps.");

  // Larry got the check-in (feeling and reason) and real candidates with their vibe; no milestone, no visit times.
  const rung = asked.find((b) => b.kind === "next_rung")!;
  expect(rung).toMatchObject({ feeling: "good", reason: "too_loud", step: { vibe: "cosy" } });
  expect((rung.candidates as { name: string }[]).map((c) => c.name)).toContain("Title Waves Books");
  expect(JSON.stringify(rung)).not.toMatch(/milestone|regular|checkin|visits/i);
  // What Larry learned went into the persona on this phone.
  const persona = await page.evaluate(() => JSON.parse(localStorage.getItem("larry.persona") ?? "{}") as { placeVibe?: string; notes?: string[] });
  expect(persona.placeVibe).toBe("calm");
  expect(persona.notes).toContain("finds loud places hard");
});
