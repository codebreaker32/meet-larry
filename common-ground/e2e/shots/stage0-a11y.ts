// Stage 0 accessibility review (research/accessibility-review.md). Not a test.
// Run with `npx tsx e2e/review-shots.ts stage0-a11y [job]`. Every model call is mocked.
// For each screen at 1440 and 390 it saves a full-page screenshot, runs axe-core (WCAG 2.0/2.1/2.2
// A and AA plus best practice), walks the page with Tab under prefers-reduced-motion (focus order,
// a visible ring, focus not hidden behind sticky bars), and measures every target (2.5.8 and 44px).
// Raw findings go to A11Y_OUT (default: the screenshot folder) as <name>-<width>.json.
import { ACCESS_TEXT } from "../../src/lib/access/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Room } from "../../src/lib/contracts";
import { encodeProfile } from "../../src/lib/card-codec";
import { DEMO_PRIYA as PRIYA, DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const AXE = path.join(__dirname, "../../node_modules/axe-core/axe.min.js");

const persona = {
  version: 1,
  name: "Sam",
  likes: SAM.items,
  dislikes: [],
  notes: ["likes board games with a few friends"],
  placeVibe: "calm",
  updatedAt: Date.now(),
};
const seedPersona = { "larry.persona": JSON.stringify(persona) };
const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const done = (result: Record<string, unknown>) => ({ type: "done", result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...result } });

interface FocusStop {
  i: number;
  desc: string;
  name: string;
  outline: string;
  boxShadow: string;
  visibleRing: boolean;
  obscured: boolean;
  offscreen: boolean;
  rect: [number, number, number, number];
}

async function audit(page: Page, kit: ShotKit, name: string, w: number, opts: { tabs?: number; full?: boolean } = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
  await kit.shot(page, name, w, opts.full ?? true);

  await page.addScriptTag({ path: AXE });
  const axe = await page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map((v: { id: string; impact: string; help: string; nodes: { target: string[]; failureSummary: string }[] }) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary.split("\n").slice(0, 3).join(" | ") })),
    }));
  });

  // Target sizes: every visible interactive element.
  const targets = await page.evaluate(() => {
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=radio], [role=tab], [tabindex]:not([tabindex="-1"])';
    const out: { desc: string; w: number; h: number; inline: boolean }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 1px boxes are sr-only content (the skip link before it has focus), not targets.
      if (r.width <= 1 || r.height <= 1 || cs.visibility === "hidden" || el.closest("[inert], dialog:not([open])")) continue;
      if (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) {
        const l = el.closest("label")!.getBoundingClientRect();
        if (l.height >= 24) continue;
      }
      const inline = el.tagName === "A" && cs.display === "inline" && !!el.closest("p, li");
      if (r.width < 44 || r.height < 44) {
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 50);
        out.push({ desc: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${label}"`, w: Math.round(r.width), h: Math.round(r.height), inline });
      }
    }
    return out;
  });

  // Keyboard walk under reduced motion.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.mouse.click(1, 1).catch(() => {});
  const stops: FocusStop[] = [];
  const max = opts.tabs ?? 70;
  let first = "";
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(220);
    const s = await page.evaluate((i) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      // The ring may sit on the element or on a wrapper drawn for it (the composer rings its whole box).
      let outlineOn = false;
      for (let n: HTMLElement | null = el, d = 0; n && d < 3 && !outlineOn; n = n.parentElement, d++) {
        const c = getComputedStyle(n);
        outlineOn = c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2;
      }
      const shadowOn = cs.boxShadow !== "none" && /\d+px\s+\d+px\s+0px\s+[2-9]px|0px 0px 0px [2-9]px/.test(cs.boxShadow);
      // Is the element's centre covered by something else (a sticky header, a fixed composer)?
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const obscured = !!top && top !== el && !el.contains(top) && !top.contains(el) && !(top instanceof HTMLLabelElement && top.control === el);
      return {
        i,
        desc: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : ""}`,
        name,
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}`,
        boxShadow: cs.boxShadow.slice(0, 80),
        visibleRing: outlineOn || shadowOn,
        obscured,
        offscreen: r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] as [number, number, number, number],
      };
    }, i);
    if (!s) continue;
    const key = `${s.desc}|${s.name}`;
    if (i > 0 && key === first) break;
    if (!first) first = key;
    stops.push(s);
    if (!s.visibleRing || s.obscured) await kit.shot(page, `${name}-focus-${s.i}`, w, false);
  }

  // Reflow (1.4.10): no sideways scroll at this width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const live = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")).map(
      (e) => `${e.tagName.toLowerCase()}[${e.getAttribute("role") ?? ""}|${e.getAttribute("aria-live") ?? ""}] "${(e.textContent ?? "").trim().slice(0, 40)}"`,
    ),
  );
  const out = process.env.A11Y_OUT ?? kit.outDir;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${name}-${w}.json`), JSON.stringify({ name, w, url: page.url(), overflow, axe, targets, stops, live }, null, 2));
  const noRing = stops.filter((s) => !s.visibleRing).length;
  const hidden = stops.filter((s) => s.obscured || s.offscreen).length;
  if (overflow > 0) console.log(`  ${name}-${w}: SIDEWAYS SCROLL ${overflow}px`);
  console.log(`  ${name}-${w}: axe ${axe.length} rules, ${targets.filter((t) => (t.w < 24 || t.h < 24) && !t.inline).length} targets <24, ${stops.length} stops, ${noRing} without ring, ${hidden} hidden`);
}

/** Opens a dialog with `open`, then checks focus moved inside, Tab stays inside, Escape closes and focus returns. */
async function dialogCheck(page: Page, kit: ShotKit, name: string, w: number, open: () => Promise<void>) {
  const trigger = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
  await open();
  await page.locator("dialog[open], [role=dialog]").first().waitFor();
  await page.waitForTimeout(300);
  await kit.shot(page, `${name}-dialog`, w, false);
  const info = await page.evaluate(() => {
    const d = document.querySelector("dialog[open], [role=dialog]") as HTMLElement;
    return {
      focusInside: !!d && d.contains(document.activeElement),
      labelled: !!d && !!(d.getAttribute("aria-labelledby") || d.getAttribute("aria-label")),
      active: document.activeElement?.outerHTML.slice(0, 80),
    };
  });
  let escaped = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    // A modal dialog may let focus reach the browser chrome (body); only a page element outside is a leak.
    const outside = await page.evaluate(() => {
      const d = document.querySelector("dialog[open], [role=dialog]");
      const a = document.activeElement;
      return !!d && !!a && a !== document.body && !d.contains(a);
    });
    if (outside) escaped++;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    closed: !document.querySelector("dialog[open], [role=dialog]"),
    active: document.activeElement?.outerHTML.slice(0, 80) ?? "",
  }));
  const out = process.env.A11Y_OUT ?? kit.outDir;
  writeFileSync(path.join(out, `${name}-dialog-${w}.json`), JSON.stringify({ trigger, ...info, escaped, ...after }, null, 2));
  console.log(`  ${name}-dialog-${w}: focusInside ${info.focusInside}, labelled ${info.labelled}, leaks ${escaped}, escCloses ${after.closed}, returns ${after.active === trigger}`);
}

async function simple(kit: ShotKit, w: number, name: string, url: string, seed: Record<string, string> = {}) {
  const ctx = await kit.context(w, seed);
  const page = await ctx.newPage();
  await page.goto(url);
  await audit(page, kit, name, w);
  await ctx.close();
}

const pairUrl = `/pair?a=${encodeProfile(SAM)}&b=${encodeProfile(PRIYA)}&owner=a`;

async function pair(kit: ShotKit, w: number) {
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
            why: "A warm, funny film both of you might like.",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/chat", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([done({ messages: [{ from: "larry", text: "Hi Sam and Priya, I'm Larry, an AI pal. You might both like Jojo Rabbit." }] })]),
    }),
  );
  await page.goto(pairUrl);
  await page.getByText("You might both like Jojo Rabbit.").first().waitFor();
  await audit(page, kit, "pair", w, { tabs: 90 });
  const help = page.getByRole("button", { name: /help|how this works|\?/i }).first();
  if (await help.count()) {
    await help.focus();
    await dialogCheck(page, kit, "pair-help", w, () => page.keyboard.press("Enter"));
  }
  await ctx.close();
}

async function larry(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seedPersona);
  const page = await ctx.newPage();
  await page.route("**/api/larry", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. Want a calm place to play nearby?" }] })]),
    }),
  );
  await page.goto("/larry");
  await page.getByText("Want a calm place to play nearby?").first().waitFor();
  await audit(page, kit, "larry", w);
  await ctx.close();
}

async function steps(kit: ShotKit, w: number) {
  const now = Date.now();
  const place = { id: "E2E00000-0000-4000-8000-0000000000C1", name: "Dice and Tea Board Game Cafe" };
  const ctx = await kit.context(w, {
    ...seedPersona,
    "cg.steps": JSON.stringify([
      { id: "s1", kind: "go", text: `Go to ${place.name}, Sat 11am.`, createdAt: now - 86400_000, done: false, placeId: place.id, placeName: place.name, vibe: "calm" },
      { id: "s2", kind: "say", text: "Ask what game they play most.", createdAt: now - 3600_000, done: true, doneAt: now - 1800_000, feeling: "good" },
    ]),
  });
  const page = await ctx.newPage();
  await page.goto("/steps");
  await audit(page, kit, "steps", w, { tabs: 90 });
  await ctx.close();
}

function makeRoom(code: string, meet: boolean): Room {
  const t = Date.now() - 120_000;
  return {
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
      { id: "1", from: "larry", at: t, toLarry: false, text: "Hi Sam and Priya, I'm Larry, an AI. You both like Spirited Away." },
      { id: "2", from: "m_priya", at: t + 30_000, toLarry: false, text: "Hi! Which Ghibli film is your favourite?" },
    ],
    ...(meet ? { meet: { venueName: "E2E Board Game Cafe", shared: ["Spirited Away"] } } : {}),
  } as Room;
}

async function liveRoom(kit: ShotKit, w: number, meet: boolean) {
  const code = meet ? "RVW2MT" : "RVW3RM";
  const creds = { code, memberId: "m_sam", token: "t".repeat(40), savedAt: Date.now() };
  const ctx = await kit.context(w, { ...seedPersona, [`larry.room.${code}`]: JSON.stringify(creds) });
  const page = await ctx.newPage();
  const room = makeRoom(code, meet);
  await page.route(`**/api/rooms/${code}**`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ room }) }));
  await page.goto(meet ? `/meet/chat/${code}` : `/room/${code}`);
  await page.getByText("Which Ghibli film is your favourite?").first().waitFor();
  const name = meet ? "meet-chat" : "room-live";
  await audit(page, kit, name, w, { tabs: 90 });
  if (meet) {
    const b = page.getByRole("button", { name: "Block or report Priya" }).first();
    await b.focus();
    await dialogCheck(page, kit, name, w, () => page.keyboard.press("Enter"));
  } else {
    const b = page.getByRole("button", { name: /invite/i }).first();
    if (await b.count()) {
      await b.focus();
      await dialogCheck(page, kit, name, w, () => page.keyboard.press("Enter"));
    }
  }
  await ctx.close();
}

async function meet(kit: ShotKit, w: number) {
  const placeId = "e2e-review-cafe-0001";
  const ctx = await kit.context(w, seedPersona, { "x-e2e-fake-qloo": "1" });
  const page = await ctx.newPage();
  await page.goto(`/meet/${placeId}`);
  await audit(page, kit, "meet-venue", w);
  const here = page.getByRole("button", { name: "I'm here" });
  if (await here.count()) {
    await here.click();
    await page.waitForTimeout(800);
    await audit(page, kit, "meet-optin", w);
  }
  await ctx.close();
}

async function code(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/code");
  await audit(page, kit, "code", w);
  await page.route("**/api/larry", (r) =>
    r.fulfill({
      status: 402,
      headers: { "x-larry-access": "spent", "content-type": "application/json" },
      body: JSON.stringify({ error: ACCESS_TEXT.spent, access: "spent" }),
    }),
  );
  await page.evaluate((p) => localStorage.setItem("larry.persona", p), JSON.stringify(persona));
  await page.goto("/larry");
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({ focusInside: document.querySelector("dialog[open]")?.contains(document.activeElement) ?? false }));
  console.log(`  access-spent-${w}: focus inside dialog on open: ${info.focusInside}`);
  await kit.shot(page, "access-spent-dialog", w, false);
  await ctx.close();
}

async function create(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/create");
  await page.getByRole("button", { name: "Spirited Away", exact: true }).waitFor();
  await audit(page, kit, "create", w, { tabs: 90 });
  await ctx.close();
}

async function join(kit: ShotKit, w: number) {
  await simple(kit, w, "join", `/join?c=${encodeProfile(PRIYA)}`);
  await simple(kit, w, "join-broken", "/join?c=nope");
}

const W320 = [320];

/** Proof shots: the skip link on the first Tab, the composer ring under reduced motion, a ring inside the bridge strip. */
async function focusProof(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seedPersona);
  const page = await ctx.newPage();
  await page.route("**/api/larry", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. Want a calm place to play nearby?" }] })]),
    }),
  );
  await page.goto("/larry");
  await page.getByText("Want a calm place to play nearby?").first().waitFor();
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const r = a.getBoundingClientRect();
    return { text: a.textContent, w: Math.round(r.width), h: Math.round(r.height) };
  });
  await kit.shot(page, "proof-skip-link", w, false);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const afterSkip = await page.evaluate(() => ({ inMain: !!document.activeElement?.closest("main"), el: document.activeElement?.textContent?.trim().slice(0, 40) }));
  console.log(`  proof-${w}: skip link ${JSON.stringify(skip)}; next Tab after Enter is in <main>: ${afterSkip.inMain} (${afterSkip.el})`);
  await page.getByRole("textbox").first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await kit.shot(page, "proof-composer-ring-reduced-motion", w, false);
  await ctx.close();
}

export const jobs: ShotJob[] = [
  { name: "landing", run: (k, w) => simple(k, w, "landing", "/") },
  { name: "landing-card", run: (k, w) => simple(k, w, "landing-with-card", "/", seedPersona) },
  { name: "create", run: create },
  { name: "card", run: (k, w) => simple(k, w, "card", "/card", seedPersona) },
  { name: "card-empty", run: (k, w) => simple(k, w, "card-empty", "/card") },
  { name: "join", run: join },
  { name: "pair", run: pair },
  { name: "larry", run: larry },
  { name: "steps", run: steps },
  { name: "me", run: (k, w) => simple(k, w, "me", "/me", seedPersona) },
  { name: "practice", run: (k, w) => simple(k, w, "practice", "/practice", seedPersona) },
  { name: "room", run: (k, w) => simple(k, w, "room-lobby", "/room", seedPersona) },
  { name: "room-live", run: (k, w) => liveRoom(k, w, false) },
  { name: "meet", run: meet },
  { name: "meet-chat", run: (k, w) => liveRoom(k, w, true) },
  { name: "code", run: code },
  { name: "proof", run: focusProof },
  // 1.4.10 reflow: the narrowest width (equal to 1280px at 400% zoom).
  { name: "reflow-landing", widths: W320, run: (k, w) => simple(k, w, "reflow-landing", "/") },
  { name: "reflow-create", widths: W320, run: create },
  { name: "reflow-pair", widths: W320, run: pair },
  { name: "reflow-steps", widths: W320, run: steps },
  { name: "reflow-room", widths: W320, run: (k, w) => liveRoom(k, w, false) },
  { name: "reflow-me", widths: W320, run: (k, w) => simple(k, w, "me", "/me", seedPersona) },
];
