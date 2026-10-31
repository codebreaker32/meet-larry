import { expect, test } from "./fixtures";

// Phone accounts (1F): the fake e2e sign-in (NEXT_PUBLIC_E2E=1, code 123456) against the real
// account API on the in-memory database (E2E=1, LARRY_DB=memory). No SMS, no Firestore.
// The test mounts AccountSection by visiting /signup and /signin; /me mounting is 1E's.

const freshPhone = () => `+9198${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

async function signIn(page: import("@playwright/test").Page, phone: string, next = "/code") {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in with your phone" })).toBeVisible();
  // A clean sign-in: no "What we keep" card here (the user's choice), just the phone field.
  await expect(page.getByRole("heading", { name: "What we keep" })).toHaveCount(0);
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your texts" })).toBeVisible();
  const code = page.getByLabel("The 6-digit code");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await code.fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That code didn't match. Check the text and try again.")).toBeVisible();
  await code.fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("sign in, sign up one question at a time, switch leaderboards, delete the account", async ({ page }) => {
  await signIn(page, freshPhone());
  await expect(page).toHaveURL(/\/signup/);

  await expect(page.getByRole("heading", { name: "Before we start" })).toBeVisible();
  // Sign-up repeats "What we keep" behind a disclosure (it was shown in full before the phone field).
  await page.locator("summary", { hasText: "What we keep" }).click();
  await expect(page.getByText("Only to check you're 18 or over. Nobody sees it.")).toBeVisible();
  await page.getByRole("button", { name: "Sounds good" }).click();

  await page.getByLabel("Your name").fill("Sam");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Your public name" })).toBeVisible();
  const nameBox = page.locator("p[aria-live=polite]");
  await expect(nameBox).toHaveText(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
  const first = await nameBox.textContent();
  await page.getByRole("button", { name: "New name" }).click();
  await expect(nameBox).not.toHaveText(first!);
  const username = (await nameBox.textContent())!;
  await page.getByRole("button", { name: "Use this name" }).click();

  await page.getByLabel("Day").selectOption("2");
  await page.getByLabel("Month").selectOption({ label: "March" });
  await page.getByLabel("Year").selectOption("1994");
  await page.getByRole("button", { name: "Make my account" }).click();
  await expect(page.getByText(`Welcome, ${username}. You're in.`)).toBeVisible();

  // The account is real on the server, and never carries the date of birth.
  const token = await page.evaluate(() => `e2e:${localStorage.getItem("larry.e2e.uid")}`);
  const me = await page.request.get("/api/account", { headers: { authorization: `Bearer ${token}` } });
  const account = await me.json();
  expect(account).toMatchObject({ username, budgetCentsLeft: 25, showOnLeaderboards: false });
  expect(JSON.stringify(account)).not.toMatch(/1994|dob|phone/);

  // AI routes now take the account's Larry time instead of asking for a code.
  const larry = await page.request.post("/api/larry", {
    data: { profile: { name: "Sam", items: [] }, history: [] },
    headers: { authorization: `Bearer ${token}`, "x-e2e-no-model": "1" },
  });
  expect(larry.status()).not.toBe(401);

  // Carry on lands where the person came from; the header link (mounted by 1U) knows the account.
  await page.getByRole("link", { name: "Carry on" }).click();
  await expect(page).toHaveURL(/\/code/);
  await expect(page.getByRole("link", { name: `Your account, ${username}` })).toBeVisible();

  // "Show me on place leaderboards" (D12, off by default) and deletion, on /me once 1E mounts AccountSection.
  await page.goto("/me");
  const section = page.locator("section#account");
  if (await section.count()) {
    const sw = section.getByRole("switch", { name: /Show me on place leaderboards/ });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await section.getByRole("button", { name: "Delete my account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dialog.getByRole("button", { name: "Keep my account" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete it all" }).click();
    await expect(section.getByRole("link", { name: "Sign in with your phone" })).toBeVisible();
  } else {
    const auth = { authorization: `Bearer ${token}` };
    expect((await (await page.request.patch("/api/account", { data: { showOnLeaderboards: true }, headers: auth })).json()).showOnLeaderboards).toBe(true);
    expect((await page.request.delete("/api/account", { headers: auth })).status()).toBe(200);
  }
  const after = await page.request.get("/api/account", { headers: { authorization: `Bearer ${token}` } });
  expect(after.status(), await after.text()).toBe(404);
});

test("under-18s get a kind exit and nothing is kept", async ({ page }) => {
  await signIn(page, freshPhone());
  await expect(page).toHaveURL(/\/signup/);
  await page.getByRole("button", { name: "Sounds good" }).click();
  await page.getByLabel("Your name").fill("Kid");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("p[aria-live=polite]")).toHaveText(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
  await page.getByRole("button", { name: "Use this name" }).click();
  await page.getByLabel("Day").selectOption("1");
  await page.getByLabel("Month").selectOption({ label: "January" });
  await page.getByLabel("Year").selectOption(String(new Date().getFullYear() - 15));
  await page.getByRole("button", { name: "Make my account" }).click();
  await expect(page.getByRole("heading", { name: "Larry still has your back" })).toBeVisible();
  await expect(page.getByText(/We didn't keep anything you typed here/)).toBeVisible();
  await page.getByRole("button", { name: "Back to Larry" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the account API stays closed without a verified token", async ({ request }) => {
  expect((await request.get("/api/account")).status()).toBe(401);
  expect((await request.patch("/api/account", { data: { showOnLeaderboards: true } })).status()).toBe(401);
  expect((await request.get("/api/account", { headers: { authorization: "Bearer not-a-token" } })).status()).toBe(401);
  const name = await (await request.get("/api/account/username")).json();
  expect(name.username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d+$/);
});
