import { expect, test } from "./fixtures";
import type { FirstStep } from "../src/lib/types";
import { SUGGEST_NUDGES, SUGGEST_STEPS } from "./fixtures";
import { done, larrySays, mockChat, mockCommonGround, SAM, seedStorage } from "./helpers";

const HELLO = "Hi Sam, I'm Larry, an AI pal. Maya is a made-up practice pal. Say hi and ask about one of her picks.";
const WRAP = "Nice work, Sam: you asked Maya a real question. Try that with a real person this week.";

test("pick a pal: the round wraps up into the First Step panel", async ({ page }) => {
  await seedStorage(page, { profile: SAM });
  await mockCommonGround(page);
  const chats = await mockChat(page, (_req, n) =>
    n === 0
      ? [done({ messages: [{ from: "larry", text: HELLO }] })]
      : [
          done({
            messages: [
              { from: "b", text: "Have I seen it? Twice. Good talk, see you." },
              { from: "larry", text: WRAP },
            ],
            wrapUp: true,
            steps: [{ kind: "say", text: "Ask a classmate what they're watching right now" }],
          }),
        ],
  );

  await page.goto("/practice");
  await expect(page.getByRole("heading", { level: 1, name: "Pick a pal" })).toBeVisible();
  // No message counts anywhere: the chats are short, but nobody is counting down.
  await expect(page.getByText(/messages now|messages long/)).toHaveCount(0);
  await page.getByRole("link", { name: "Chat with Maya" }).click();
  await expect(page).toHaveURL(/\/practice\/chat\?persona=maya$/);

  await expect(page.getByText("Maya is a made-up practice pal played by AI.")).toBeVisible();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat.getByText(HELLO)).toBeVisible();
  await expect(chat.getByText("Larry (AI pal)")).toBeVisible();
  // Practice has one person, so there's no "who is talking" toggle in the way.
  await expect(page.getByRole("group", { name: "Who is talking?" })).toBeHidden();

  // One short, warm nudge (written by AI per session; mocked here), and no countdown.
  await expect(page.getByText(SUGGEST_NUDGES[0], { exact: true })).toBeVisible();
  await expect(page.getByText(/practice round is|messages left|Shorter round/)).toHaveCount(0);
  await page.getByRole("group", { name: "Sam's replies to Maya" }).getByRole("button", { name: "Have you seen it?" }).click();
  await expect(chat.getByText("Maya (practice pal)")).toBeVisible();
  await expect(chat.getByText(WRAP)).toBeVisible();

  // wrapUp: the composer is replaced by the end panel, with no way back into the round.
  const panel = page.getByRole("region", { name: "Save a First Step" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Practice round done. Nice work, Sam. Now pick one thing to try with a real person.");
  await expect(panel.getByRole("button", { name: "Keep talking" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Message from/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();

  const larrys = panel.getByRole("button", { name: /Ask a classmate what they're watching right now/ });
  await expect(larrys).toHaveAttribute("aria-pressed", "true");
  // Fresh First Step ideas from /api/suggest (mocked), not the fixed fallback.
  await expect(panel.getByRole("button", { name: new RegExp(SUGGEST_STEPS[0].text) })).toBeVisible();

  // No one else is on this phone, so saving goes straight to /steps.
  await panel.getByRole("button", { name: "Save this step" }).click();
  await expect(page).toHaveURL(/\/steps$/);
  // Wait for the steps page itself: the chat page can still be mounted for a moment after the URL changes.
  await expect(page.getByRole("heading", { name: "First Steps", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "I did it: Ask a classmate what they're watching right now", exact: true })).toBeVisible();

  expect(chats).toHaveLength(2);
  expect(chats.every((c) => c.persona === "maya")).toBe(true);
  expect(chats.every((c) => c.stepsDone === 0)).toBe(true);
});

const DAY = 24 * 60 * 60 * 1000;
const doneStep = (id: string, text: string): FirstStep => ({
  id,
  kind: "say",
  text,
  createdAt: Date.now() - 3 * DAY,
  done: true,
  doneAt: Date.now() - DAY,
  feeling: "good",
});

test("each real First Step done makes practice shorter: 2 done steps, a 4-message round", async ({ page }) => {
  await seedStorage(page, {
    profile: SAM,
    steps: [doneStep("d1", "Ask Priya about Heartstopper"), doneStep("d2", "Say hi to Jo in class")],
  });
  await mockCommonGround(page);
  // The model never wraps up here: the client closes the round at the cap by itself.
  const chats = await mockChat(page, (_req, n) =>
    n === 0 ? larrySays("Hi Sam, I'm Larry, an AI pal. Say hi to Maya.") : [done({ messages: [{ from: "b", text: `Reply ${n}.` }] })],
  );

  await page.goto("/practice");
  // No "shorter" talk on the list either: the cap works unseen.
  await expect(page.getByText(/shorter/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Chat with Maya" }).click();

  const chat = page.getByRole("region", { name: "Chat" });
  const box = page.getByRole("textbox", { name: "Message from Sam" });
  for (let i = 1; i <= 4; i++) {
    await box.fill(`Message ${i}`);
    await box.press("Enter");
    await expect(chat.getByText(`Reply ${i}.`, { exact: true })).toBeVisible();
    // The cap works unseen: no countdown and no "shorter round" line, only a short nudge.
    await expect(page.getByText(/practice round is|messages left|Shorter round|Last message/)).toHaveCount(0);
    if (i < 4) await expect(page.getByText(new RegExp(`^(${SUGGEST_NUDGES.join("|").replace(/\./g, "\\.")})$`))).toBeVisible();
  }

  // Exactly at the cap, with no extra rounds: the end panel takes over.
  const panel = page.getByRole("region", { name: "Save a First Step" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Practice round done.");
  await expect(page.getByRole("textbox", { name: /Message from/ })).toHaveCount(0);
  expect(chats).toHaveLength(5);
  expect(chats.every((c) => c.stepsDone === 2)).toBe(true);
});
