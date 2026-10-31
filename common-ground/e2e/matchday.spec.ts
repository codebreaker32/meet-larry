import { expect, test } from "./fixtures";

// Match Day and Rising, the honest forms (qloo-hooks-plan 3.1 and 3.5). The fixtures file ships
// empty (no hand-verified fixture inside the window), so Match Day answers no date and Larry's
// off-season line; Rising answers nothing rather than "rising in <city>". No Qloo or model call.

const MI = "11E8F514-0D1A-45F8-B180-06068C4F7D29";

test("/api/matchday: no fixture means no date, and an honest line instead", async ({ request }) => {
  const res = await request.get(`/api/matchday?entities=${MI}&team=Mumbai%20Indians`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.matchDays).toEqual([]);
  expect(body.fallback.line).toBe("No Mumbai Indians game I can vouch for this week, and I won't make one up. Classic-match night at a calm café instead?");
  expect(JSON.stringify(body)).not.toMatch(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|next game/i);
});

test("/api/matchday refuses a bad request warmly", async ({ request }) => {
  const res = await request.get("/api/matchday?entities=");
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("Pick a team first.");
});

test("/api/rising: nothing claimed, never a city", async ({ request }) => {
  const res = await request.get("/api/rising");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.items).toEqual([]);
  expect(body.miss.line).toMatch(/can vouch for/);
  expect(JSON.stringify(body)).not.toMatch(/rising in|Mumbai|Bengaluru|Delhi/i);
});
