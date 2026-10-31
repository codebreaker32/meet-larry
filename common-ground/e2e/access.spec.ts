import { expect, test } from "./fixtures";
import { SAM, seedStorage } from "./helpers";

// Larry time: every AI route needs an account (Bearer token) or an access code, and time that is used
// up says so warmly. Only the check runs here: with neither, or a spent one, the server stops before
// any model call. Accounts paying with their own Larry time are covered in auth.spec.ts.

test("AI routes need Larry time, and a spent code gets the warm budget message", async ({ request }) => {
  const body = { profile: SAM, history: [] };
  const missing = await request.post("/api/larry", { data: body });
  expect(missing.status()).toBe(401);
  expect(missing.headers()["x-larry-access"]).toBe("missing");
  expect(await missing.json()).toMatchObject({ access: "missing" });

  const wrong = await request.post("/api/larry", { data: body, headers: { "x-larry-code": "LARRY-2222-2222" } });
  expect(wrong.status()).toBe(401);
  expect(await wrong.json()).toMatchObject({ access: "invalid" });

  const spent = await request.post("/api/larry", { data: body, headers: { "x-larry-code": process.env.E2E_SPENT_CODE! } });
  expect(spent.status()).toBe(402);
  expect(await spent.json()).toMatchObject({
    error: "That's your Larry time for now! Everything else (your card, places, plans) still works.",
    access: "spent",
  });

  // The pair chat too; a crisis line is still answered, code or not.
  const pair = await request.post("/api/chat", { data: { a: SAM, b: SAM, history: [] } });
  expect(pair.status()).toBe(401);
  const crisis = await request.post("/api/larry", {
    data: { profile: SAM, history: [{ role: "user", content: "[Sam] I want to kill myself" }] },
  });
  expect(crisis.status()).toBe(200);
  expect(await crisis.text()).toContain('"crisis":true');
});

test("without Larry time, the page offers sign-in or a code; a spent code shows the budget message; /code checks codes", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  // Let /api/larry reach the real server (which stops at the code check).
  await page.route("**/api/larry", (route) => route.continue());
  await page.goto("/larry");
  const prompt = page.getByRole("dialog");
  await expect(prompt.getByRole("heading", { name: "Get your Larry time" })).toBeVisible();
  await expect(prompt.getByRole("link", { name: "Sign in with your phone" })).toHaveAttribute("href", "/signin?next=%2Flarry");
  await expect(prompt.getByRole("textbox")).toBeVisible();
  await expect(prompt.getByText("No code? Signing in gives you your own Larry time.")).toBeVisible();

  // A code that has used its AI time.
  await page.evaluate((c) => localStorage.setItem("larry.accessCode", c), process.env.E2E_SPENT_CODE!);
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "That's your Larry time for now" })).toBeVisible();

  // The /code page: a wrong code is refused, a working one is saved.
  await page.goto("/code");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in with your phone" })).toBeVisible();
  const field = page.getByRole("textbox").first();
  await field.fill("LARRY-2222-2222");
  await field.press("Enter");
  await expect(page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: /isn't|not|wrong|check/i }).first()).toBeVisible();
  await field.fill(process.env.E2E_CODE!.toLowerCase().replace(/-/g, " "));
  await field.press("Enter");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("larry.accessCode"))).toBe(process.env.E2E_CODE);
});
