import { randomUUID } from "node:crypto";
import { expect, freshIp, guardModel, test } from "./fixtures";
import { SAM, seedStorage } from "./helpers";

// Regression tests for the fixes from the persona walkthroughs (research/persona-walkthroughs.md):
// Aarav (anxious), Meera (stammer), Rohan with his supporter Anjali (easy-read), Diego (new in town)
// and the cold second person. The model and Qloo are mocked at the HTTP boundary; location is a
// simulated browser geolocation. The handover screen is covered in card.spec.ts.

test("Rohan and Diego: Coco and FC Goa are pictures to tap, with no spelling needed", async ({ page }) => {
  await page.goto("/create");
  await expect(page.getByRole("heading", { level: 1, name: "Make your taste card" })).toBeVisible();
  await page.getByRole("button", { name: "Coco", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Coco" })).toBeVisible();

  await page.getByRole("group", { name: "What kind of thing?" }).getByRole("button", { name: "Sports" }).click();
  await page.getByRole("group", { name: "Which sport?" }).getByRole("button", { name: "Football" }).click();
  await page.getByRole("button", { name: "FC Goa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove FC Goa" })).toBeVisible();
});

test("Rohan: the places ladder speaks in plain words, with no rungs", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await page.goto("/steps");
  await expect(page.getByRole("heading", { level: 1, name: "First Steps" })).toBeVisible();
  // D24: no location button; one plain line says where to turn places on.
  await expect(page.getByRole("link", { name: "Places near you are off. Turn on in Your taste > Settings." })).toHaveAttribute("href", "/me#settings");
  await expect(page.getByText(/\brungs?\b|ladder/i)).toHaveCount(0);
});

test("Rohan, Anjali and Diego: Open to meet shows what others see from your own pick, names money as a red flag, and an empty venue is a door", async ({
  browser,
}, testInfo) => {
  test.slow();
  // A real server: the dev-only fake-Qloo header makes any place id a public café at this location.
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    extraHTTPHeaders: { "x-real-ip": freshIp(), "x-e2e-fake-qloo": "1" },
    reducedMotion: "reduce",
    geolocation: { latitude: 51.5072, longitude: -0.1276, accuracy: 20 },
    permissions: ["geolocation"],
  });
  await guardModel(context);
  // Open to meet is for signed-in 18+ accounts: Rohan has one (fake e2e token, in-memory database).
  const uid = `persona-${randomUUID().slice(0, 12)}`;
  const auth = { authorization: `Bearer e2e:${uid}` };
  const { username } = (await (await context.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  const made = await context.request.post("/api/account", { data: { name: "Rohan", username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
  expect(made.status(), await made.text()).toBeLessThan(300);
  const tag = randomUUID().slice(0, 6);
  const persona = {
    version: 1,
    name: "Rohan",
    likes: [
      { id: randomUUID().toUpperCase(), name: `Dhoni ${tag}`, domain: "athlete" },
      { id: randomUUID().toUpperCase(), name: `Coco ${tag}`, domain: "movie" },
      { id: randomUUID().toUpperCase(), name: `Arijit ${tag}`, domain: "artist" },
    ],
    dislikes: [],
    notes: [],
    updatedAt: Date.now(),
  };
  await context.addInitScript(
    ([p, accessCode, id]) => {
      localStorage.setItem("larry.e2e.uid", id);
      if (sessionStorage.getItem("e2e.seeded")) return;
      sessionStorage.setItem("e2e.seeded", "1");
      localStorage.setItem("larry.persona", p);
      if (accessCode) localStorage.setItem("larry.accessCode", accessCode);
    },
    [JSON.stringify(persona), process.env.E2E_CODE ?? "", uid] as const,
  );
  const page = await context.newPage();
  await page.goto(`/meet/e2e-${randomUUID()}`);
  await page.getByRole("button", { name: "I'm here" }).click();

  // The preview is built from Rohan's own first pick, beside what nobody sees.
  await expect(page.getByText("This is all people here see")).toBeVisible();
  await expect(page.getByText(`Someone here likes Dhoni ${tag} too.`)).toBeVisible();
  for (const thing of ["Your name", "Your photo", "Where you go"]) await expect(page.getByRole("listitem").filter({ hasText: thing })).toBeVisible();
  // The safety note names money, addresses and private places in plain words.
  await expect(page.getByText(/If someone asks for money, your home address, or to go somewhere private/)).toBeVisible();
  await expect(page.getByText("Open to meet is for 18+. Quick check, and you're in.")).toBeVisible();

  await page.getByLabel("I am 18 or over.").check();
  await page.getByRole("button", { name: "Switch on Open to meet" }).click();
  await expect(page.getByText("Open to meet is on")).toBeVisible();

  // Nobody else here: said warmly, with the next real thing to do.
  await expect(page.getByText(/Nobody here shares your taste yet\. That's normal/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "See your next step" })).toHaveAttribute("href", "/steps");
  await page.getByRole("button", { name: "Switch off" }).click();
  await context.request.delete("/api/account", { headers: auth });
  await context.close();
});
