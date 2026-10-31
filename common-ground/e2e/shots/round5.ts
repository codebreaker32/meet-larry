// Round 5 review screenshots: create, /me, Talk taste, pair places, ladder, Open to meet, access code.
// Run with `npx tsx e2e/review-shots.ts round5 [job]`. Every model call is mocked at the HTTP boundary;
// Open to meet answers are mocked too, except the venue check, which uses the dev-only fake Qloo header.
import { ACCESS_TEXT } from "../../src/lib/access/shared";
import type { PlaceCard, PlanTicket, Room } from "../../src/lib/contracts";
import { encodeProfile } from "../../src/lib/card-codec";
import { DEMO_PRIYA as PRIYA, DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" as const };
const persona = {
  version: 1,
  name: "Sam",
  likes: [
    ...SAM.items,
    STARDEW,
    { id: "11E8F514-0D1A-45F8-B180-06068C4F7D29", name: "Mumbai Indians", domain: "sports_team" },
    { id: "67764010-965B-4787-A53B-0B8F60EDD5ED", name: "Virat Kohli", domain: "athlete" },
    { id: "86BC43F3-A5EA-4EB2-942B-999F5AE69B4F", name: "Stuff You Should Know", domain: "podcast" },
  ],
  dislikes: [{ name: "Horror films" }],
  notes: ["plays cricket", "likes board games with a few friends"],
  placeVibe: "calm",
  updatedAt: Date.now(),
};

const cafe = (fits: PlaceCard["fits"]): PlaceCard => ({
  id: "E2E00000-0000-4000-8000-0000000000C1",
  name: "Dice & Tea Board Game Café",
  distanceKm: 0.6,
  tags: ["Board games", "Wi-Fi", "Quiet"],
  affinity: 0.9,
  vibe: "calm",
  hours: "Mon-Fri 10am-8pm, Sat-Sun 9am-9pm",
  slots: ["Sat 11am", "Sun 2pm"],
  fits,
});
const books = (fits: PlaceCard["fits"]): PlaceCard => ({
  id: "E2E00000-0000-4000-8000-0000000000C2",
  name: "Title Waves Books",
  distanceKm: 0.3,
  tags: ["Bookshop", "Reading corner"],
  affinity: 0.82,
  vibe: "cosy",
  hours: "Mon-Sun 10am-7pm",
  fits,
});
const arcade = (fits: PlaceCard["fits"]): PlaceCard => ({
  id: "E2E00000-0000-4000-8000-0000000000C3",
  name: "Pixel Arcade",
  distanceKm: 1.1,
  tags: ["Arcade", "Retro games"],
  affinity: 0.7,
  vibe: "lively",
  hours: "Mon-Sun 11am-10pm",
  fits,
});
const ticketFor = (place: PlaceCard): PlanTicket => ({
  place,
  when: "Sat 11am",
  item: { ...STARDEW, image: undefined },
  opener: "Have you played Stardew Valley? I keep restarting my farm.",
  planB: "If it's too busy, we'll walk to Title Waves Books next door.",
  rung: 0,
});

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const done = (result: Record<string, unknown>) => ({ type: "done", result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...result } });

const seedPersona = { "larry.persona": JSON.stringify(persona) };

async function createWithSports(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/create");
  for (const t of ["Spirited Away", "Interstellar"]) await page.getByRole("button", { name: t, exact: true }).click();
  const kinds = page.getByRole("group", { name: "What kind of thing?" });
  await kinds.getByRole("button", { name: "Sports", exact: true }).click();
  await page.getByRole("group", { name: "Which sport?" }).getByRole("button", { name: "Cricket", exact: true }).click();
  for (const t of ["Mumbai Indians", "India Men's National Cricket Team"]) await page.getByRole("button", { name: t, exact: true }).click();
  // Not "networkidle": the picture rows keep a request open on this page.
  await page.waitForTimeout(800);
  await kit.shot(page, "create-sports", w);
  await ctx.close();
}

async function me(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seedPersona);
  const page = await ctx.newPage();
  await page.goto("/me");
  await page.getByRole("heading", { name: "Your taste, by Larry" }).waitFor();
  await page.waitForLoadState("networkidle");
  await kit.shot(page, "me-persona", w, true);
  await ctx.close();
}

async function talkTaste(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seedPersona);
  const page = await ctx.newPage();
  let n = 0;
  const card = cafe([{ who: "me", likely: "likes", why: "board games, and it's quiet" }]);
  await page.route("**/api/larry", (r) => {
    const events =
      n++ === 0
        ? [done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. You like Minecraft and Stardew Valley. Want a calm place to play nearby?" }] })]
        : [
            done({
              messages: [{ from: "larry", text: "Fans of Stardew Valley go to this calm board-game café, 0.6 km away. I made you a plan." }],
              places: [card, books([{ who: "me", likely: "maybe", why: "maybe, it gets busy after school" }])],
              planTicket: ticketFor(card),
              personaUpdate: { addLikes: [], addDislikes: [], addNotes: ["likes quiet mornings"], placeVibe: "calm" },
            }),
          ];
    return r.fulfill({ contentType: "application/x-ndjson", body: ndjson(events) });
  });
  await page.goto("/larry");
  await page.getByText("Want a calm place to play nearby?").first().waitFor();
  const box = page.getByRole("textbox", { name: "Message from Sam" });
  await box.fill("Yes please, somewhere quiet.");
  await box.press("Enter");
  await page.getByText("Larry learned:").first().waitFor();
  await page.waitForLoadState("networkidle");
  await kit.shot(page, "talk-taste", w);
  await page.getByRole("region", { name: "Chat" }).getByRole("button", { name: "See the plan" }).click();
  await page.getByRole("region", { name: "Your plan" }).waitFor();
  await page.getByRole("region", { name: "Your plan" }).scrollIntoViewIfNeeded();
  await kit.shot(page, "plan-ticket", w);
  await ctx.close();
}

async function pairPlaces(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seedPersona);
  const page = await ctx.newPage();
  await page.route("**/api/common-ground", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        shared: [],
        bridges: [
          {
            id: "B1A2C3D4-0000-4000-8000-000000000001",
            name: "Jojo Rabbit",
            domain: "movie",
            affinity: 0.81,
            fromA: ["Minecraft"],
            fromB: ["Little Women"],
            why: "A warm, funny film: Sam would like its playful world-building, and Priya the family heart she loves in Little Women.",
          },
        ],
      }),
    }),
  );
  let n = 0;
  const fits = (a: string, b: string, la: PlaceCard["fits"][0]["likely"], lb: PlaceCard["fits"][0]["likely"]) => [
    { who: "a", likely: la, why: a },
    { who: "b", likely: lb, why: b },
  ];
  await page.route("**/api/chat", (r) => {
    const events =
      n++ === 0
        ? [done({ messages: [{ from: "larry", text: "Hi Sam and Priya, I'm Larry, an AI pal. You might both like Jojo Rabbit." }] })]
        : [
            done({
              messages: [{ from: "larry", text: "Here are three real places near you, from calm to lively." }],
              places: [
                cafe(fits("board games, and it's quiet", "maybe, it can get busy at weekends", "likes", "maybe")),
                books(fits("a cosy reading corner", "Heartstopper is on the shelves", "likes", "likes")),
                arcade(fits("probably not, it's loud", "retro games she'd try", "not-for-them", "maybe")),
              ],
            }),
          ];
    return r.fulfill({ contentType: "application/x-ndjson", body: ndjson(events) });
  });
  await page.goto(`/pair?a=${encodeProfile(SAM)}&b=${encodeProfile(PRIYA)}&owner=a`);
  await page.getByText("You might both like Jojo Rabbit.").first().waitFor();
  const box = page.getByRole("textbox", { name: /Message from/ });
  await box.fill("Where could we go?");
  await box.press("Enter");
  await page.getByText("Here are three real places").first().waitFor();
  await page.waitForLoadState("networkidle");
  const list = page.getByText("board games, and it's quiet").first();
  await list.scrollIntoViewIfNeeded();
  await kit.shot(page, "place-cards-fits", w);
  await ctx.close();
}

async function ladder(kit: ShotKit, w: number) {
  const now = Date.now();
  const step = (id: string, place: PlaceCard, done: boolean, at: number) => ({
    id,
    kind: "go",
    text: `Go to ${place.name}, Sat 11am. Bring up Stardew Valley.`,
    createdAt: at,
    done,
    ...(done ? { doneAt: at + 3600_000, feeling: "good" } : {}),
    placeId: place.id,
    placeName: place.name,
    vibe: place.vibe,
    opener: "Have you played Stardew Valley?",
    planB: "If it's too busy, I'll come back on a weekday morning.",
  });
  const c = cafe([]);
  const b = books([]);
  const ctx = await kit.context(w, {
    ...seedPersona,
    "cg.steps": JSON.stringify([step("s1", c, true, now - 5 * 86400_000), step("s2", b, false, now - 60_000)]),
    // Check-in v2: verified visits folded into private counters (counts, not a diary).
    "larry.places": JSON.stringify([
      { placeId: c.id, placeName: c.name, visits: 3, weeksBits: "111", totalWeeks: 3, lastIsoWeek: "2026-W44", stage: "regular", spotWeeks: 3 },
      { placeId: b.id, placeName: b.name, visits: 1, weeksBits: "1", totalWeeks: 1, lastIsoWeek: "2026-W44", stage: "rookie", spotWeeks: 1 },
    ]),
    "larry.ageBucket": JSON.stringify("25-34"),
  });
  const page = await ctx.newPage();
  // Arrive is checked on the server with one location fix; answered here.
  await page.route("**/api/checkins/arrive", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ visitToken: "x".repeat(20), dwellMs: 1_200_000 }) }),
  );
  await page.goto("/steps");
  await page.getByRole("button", { name: `I'm here: ${b.name}` }).first().click();
  await page.getByRole("button", { name: "I'm here", exact: true }).click();
  await page.getByRole("region", { name: /You're at/ }).waitFor();
  await kit.shot(page, "checkin-milestone", w);
  await page.getByRole("region", { name: "Quiet to lively" }).scrollIntoViewIfNeeded();
  await kit.shot(page, "ladder-milestones", w, true);
  await ctx.close();
}

async function meetScreens(kit: ShotKit, w: number) {
  const placeId = "e2e-review-cafe-0001";
  const ctx = await kit.context(w, { ...seedPersona, "larry.accessCode": process.env.E2E_CODE ?? "" }, { "x-e2e-fake-qloo": "1" });
  const page = await ctx.newPage();
  await page.route(`**/api/meet/${placeId}/open`, (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionId: "s_review_session_0001", expiresAt: Date.now() + 3 * 3600_000 }) }),
  );
  await page.route(`**/api/meet/${placeId}`, (r) => {
    if (!r.request().headers()["x-meet-session"]) return r.fallback();
    return r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        venue: { name: "E2E Board Game Cafe" },
        expiresAt: Date.now() + 3 * 3600_000,
        matches: [],
        groups: [
          { groupId: "g_review0001", kind: "pick", thing: "Spirited Away", count: 2, line: "2 people here like Spirited Away too.", waved: false },
          { groupId: "g_review0002", kind: "bridge", thing: "Stardew Valley", count: 1, line: "Larry thinks you and someone here would both love Stardew Valley.", waved: true },
        ],
      }),
    });
  });
  await page.goto(`/meet/${placeId}`);
  await page.getByRole("button", { name: "I'm here" }).click();
  await page.getByLabel("I am 18 or over.").check();
  await kit.shot(page, "meet-optin-18", w, true);
  await page.getByRole("button", { name: "Switch on Open to meet" }).click();
  await page.getByText("2 people here like Spirited Away too.").waitFor();
  await kit.shot(page, "meet-nearby", w, true);
  await ctx.close();
}

async function meetRoom(kit: ShotKit, w: number) {
  const code = "RVW2MT";
  const creds = { code, memberId: "m_sam", token: "t".repeat(40), savedAt: Date.now() };
  const ctx = await kit.context(w, { ...seedPersona, [`larry.room.${code}`]: JSON.stringify(creds) });
  const page = await ctx.newPage();
  const t = Date.now() - 120_000;
  const room: Room = {
    code,
    createdAt: t,
    version: 3,
    larryBusy: false,
    steps: [],
    members: [
      { id: "m_sam", name: "Sam", profile: SAM, color: "var(--film)", joinedAt: t, lastSeenAt: Date.now() },
      { id: "m_priya", name: "Priya", profile: PRIYA, color: "var(--music)", joinedAt: t, lastSeenAt: Date.now() },
    ],
    messages: [
      {
        id: "1",
        from: "larry",
        at: t,
        toLarry: false,
        text: "Hi Sam and Priya, I'm Larry, an AI. You both like Spirited Away. If you meet, meet here at E2E Board Game Cafe, in the public area. Either of you can leave, block or report at any time.",
      },
      { id: "2", from: "m_priya", at: t + 30_000, toLarry: false, text: "Hi! Which Ghibli film is your favourite?" },
      { id: "3", from: "m_sam", at: t + 60_000, toLarry: false, text: "Spirited Away, easily. The train scene." },
    ],
    meet: { venueName: "E2E Board Game Cafe", shared: ["Spirited Away"] },
  };
  await page.route(`**/api/rooms/${code}**`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ room }) }));
  await page.goto(`/meet/chat/${code}`);
  await page.getByRole("heading", { name: "You both waved" }).waitFor();
  await page.waitForLoadState("networkidle");
  await kit.shot(page, "meet-room", w);
  await page.getByRole("button", { name: "Block or report Priya" }).first().click();
  await page.getByRole("dialog").getByRole("heading", { name: "Keep yourself safe" }).waitFor();
  await kit.shot(page, "meet-room-block-report", w);
  await ctx.close();
}

async function codePage(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/code");
  await page.getByRole("heading", { name: "Your access code" }).waitFor();
  await kit.shot(page, "access-code", w);
  // The prompt that opens when an AI route says the code's time is used up.
  await page.route("**/api/larry", (r) =>
    r.fulfill({
      status: 402,
      headers: { "x-larry-access": "spent", "content-type": "application/json" },
      body: JSON.stringify({ error: ACCESS_TEXT.spent, access: "spent" }),
    }),
  );
  await page.evaluate((p) => localStorage.setItem("larry.persona", p), JSON.stringify(persona));
  await page.goto("/larry");
  await page.getByRole("dialog").getByRole("heading", { name: "That's your Larry time for now" }).waitFor();
  await kit.shot(page, "access-spent-prompt", w);
  await ctx.close();
}

export const jobs: ShotJob[] = [
  { name: "create", run: createWithSports },
  { name: "me", run: me },
  { name: "talk", run: talkTaste },
  { name: "pair", run: pairPlaces },
  { name: "ladder", run: ladder },
  { name: "meet", run: meetScreens },
  { name: "meetroom", run: meetRoom },
  { name: "code", run: codePage },
];
