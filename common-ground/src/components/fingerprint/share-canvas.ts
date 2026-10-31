"use client";

// Share images made in code (queue "Badges and hero art": canvas + the Larry avatar + Anybody type, in
// the card-table style). Colours are read from the CSS tokens at draw time, so globals.css stays the
// one source of truth. Every string drawn goes through `text()`, which records it: the canvas carries
// the list in data-share-lines, and the e2e test checks it holds no venue, title, Glory or date.
//
// The lines handed in were already filtered by shareSafe() in src/lib/fingerprint.ts; `text()`
// checks each one again, so a future caller can't draw an unsafe line by mistake.

import QRCode from "qrcode";
import { LARRY_ASSETS } from "@/components/larry-avatar";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import { type FingerprintShare, type OverlapShare, shareSafe } from "@/lib/fingerprint";
import { QR_OPTIONS } from "@/lib/qr";
import type { Domain } from "@/lib/types";

export const SHARE_W = 1080;
export const SHARE_H = 1350;

interface Tokens {
  table: string;
  ink: string;
  paper: string;
  paperSoft: string;
  mat: string;
  line: string;
  inkSoft: string;
  foil: string[];
  display: string;
  body: string;
}

function readTokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  // Fallbacks only matter if the stylesheet failed: neutral system colours, never a brand hex.
  return {
    table: v("--table", "Canvas"),
    ink: v("--ink", "CanvasText"),
    paper: v("--paper", "Canvas"),
    paperSoft: v("--paper-soft", "GrayText"),
    mat: v("--mat", "CanvasText"),
    line: v("--line", "GrayText"),
    inkSoft: v("--ink-soft", "GrayText"),
    foil: ["--cat-film", "--cat-tv", "--cat-music", "--cat-games", "--cat-books"].map((n) => v(n, "GrayText")),
    display: `${v("--font-anybody", "")}${v("--font-anybody", "") ? ", " : ""}${v("--font-atkinson", "sans-serif")}, sans-serif`,
    body: `${v("--font-atkinson", "system-ui")}, system-ui, sans-serif`,
  };
}

/** A category colour token ("var(--cat-games)") as a real colour for the canvas. */
function catColor(d: Domain): string {
  const m = DOMAIN_STYLE[d].color.match(/var\((--[\w-]+)\)/);
  return (m && getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()) || "GrayText";
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The big mascot when 1U's larger asset is there, else the 192px one. */
async function larryImage(): Promise<HTMLImageElement | null> {
  return (await loadImage(LARRY_ASSETS.full512)) ?? (await loadImage(LARRY_ASSETS.full192));
}

async function fontsReady(t: Tokens) {
  try {
    await Promise.all([document.fonts.load(`900 64px ${t.display}`), document.fonts.load(`700 32px ${t.body}`)]);
  } catch {
    // The fallback font still draws.
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.replace(/\s*\S+$/, "");
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A drawing session that records every string it puts on the canvas. */
function session(canvas: HTMLCanvasElement, names: readonly string[] = []) {
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const drawn: string[] = [];
  const text = (s: string, x: number, y: number) => {
    // Belt and braces: a line that fails the share rule is never drawn.
    if (!s || !shareSafe(s.replace(/…$/, ""), { names })) return;
    drawn.push(s);
    ctx.fillText(s, x, y);
  };
  return { ctx, drawn, text };
}

/** The table, the ink card with its foil edge, and the Larry avatar with the wordmark. */
async function cardTable(ctx: CanvasRenderingContext2D, t: Tokens, text: (s: string, x: number, y: number) => void) {
  ctx.fillStyle = t.table;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  const x = 60;
  const y = 60;
  const w = SHARE_W - 120;
  const h = SHARE_H - 120;
  // Foil edge: a conic sweep through the category hues, as on the real taste card.
  const foil = typeof ctx.createConicGradient === "function" ? ctx.createConicGradient(-Math.PI / 4, SHARE_W / 2, SHARE_H / 2) : ctx.createLinearGradient(x, y, x + w, y + h);
  t.foil.forEach((c, i) => foil.addColorStop(i / t.foil.length, c));
  foil.addColorStop(1, t.foil[0]);
  roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 56);
  ctx.fillStyle = foil;
  ctx.fill();
  roundRect(ctx, x, y, w, h, 48);
  ctx.fillStyle = t.ink;
  ctx.fill();

  const larry = await larryImage();
  const ax = x + 56;
  const ay = y + 56;
  if (larry) {
    ctx.save();
    roundRect(ctx, ax, ay, 132, 132, 28);
    ctx.fillStyle = t.table;
    ctx.fill();
    ctx.clip();
    ctx.drawImage(larry, ax, ay, 132, 132);
    ctx.restore();
  }
  ctx.fillStyle = t.paper;
  ctx.font = `900 64px ${t.display}`;
  ctx.textBaseline = "alphabetic";
  text("Larry", ax + 160, ay + 80);
  ctx.fillStyle = t.paperSoft;
  ctx.font = `700 30px ${t.body}`;
  text("Taste, then real people", ax + 162, ay + 122);
  return { x, y, w, h };
}

async function qrImage(link: string | undefined): Promise<HTMLImageElement | null> {
  if (!link) return null;
  try {
    return await loadImage(await QRCode.toDataURL(link, { ...QR_OPTIONS, width: 360 }));
  } catch {
    return null;
  }
}

export interface DrawResult {
  /** Every string drawn, in order. */
  lines: string[];
}

/**
 * The Taste Fingerprint image: the less-known count, the Ask-me line on a paper tile with its plain
 * line, Larry's caption, the subtitle, and (18+ only) a QR that opens "make your own card". Nothing
 * else: no venue, title, Glory, date or "Your places" can reach it. Every line is at least 36px.
 */
export async function drawFingerprint(
  canvas: HTMLCanvasElement,
  share: FingerprintShare,
  opts: { qrLink?: string; qrLabel?: string; names?: string[] },
): Promise<DrawResult> {
  const t = readTokens();
  await fontsReady(t);
  const { ctx, drawn, text } = session(canvas, opts.names);
  const card = await cardTable(ctx, t, text);
  const left = card.x + 56;
  const inner = card.w - 112;
  let y = card.y + 290;

  ctx.fillStyle = t.paper;
  ctx.font = `900 54px ${t.display}`;
  for (const l of wrap(ctx, share.title, inner, 2)) {
    text(l, left, y);
    y += 62;
  }

  if (share.stat) {
    y += 40;
    ctx.font = `700 44px ${t.body}`;
    ctx.fillStyle = t.paperSoft;
    for (const l of wrap(ctx, share.stat, inner, 2)) {
      text(l, left, y);
      y += 54;
    }
  }

  if (share.twin) {
    y += 30;
    ctx.font = `900 48px ${t.display}`;
    const lines = wrap(ctx, share.twin, inner - 64, 2);
    ctx.font = `700 36px ${t.body}`;
    const plain = share.twinPlain ? wrap(ctx, share.twinPlain, inner - 64, 2) : [];
    const h = lines.length * 58 + plain.length * 46 + 64;
    roundRect(ctx, left, y, inner, h, 28);
    ctx.fillStyle = t.paper;
    ctx.fill();
    ctx.fillStyle = t.ink;
    let ty = y + 72;
    ctx.font = `900 48px ${t.display}`;
    for (const l of lines) {
      text(l, left + 32, ty);
      ty += 58;
    }
    ctx.font = `700 36px ${t.body}`;
    for (const l of plain) {
      text(l, left + 32, ty);
      ty += 46;
    }
    y += h;
  }

  const qr = await qrImage(opts.qrLink);
  const qrSize = qr ? 220 : 0;
  const bottom = card.y + card.h - 56;
  // The subtitle sits at the bottom left; the caption above it, clear of the QR.
  ctx.font = `700 36px ${t.body}`;
  const subLines = wrap(ctx, share.subtitle, inner - (qr ? qrSize + 40 : 0), 2);
  const subTop = bottom - (subLines.length - 1) * 46;
  if (share.caption) {
    const maxW = inner - (qr ? qrSize + 40 : 0);
    const lines = wrap(ctx, `“${share.caption}”`, maxW, 3);
    let cy = Math.max(subTop - 70 - lines.length * 46 - 46, y + 70);
    ctx.fillStyle = t.paperSoft;
    text("Larry (AI) says", left, cy);
    cy += 50;
    ctx.fillStyle = t.paper;
    for (const l of lines) {
      text(l, left, cy);
      cy += 46;
    }
  }
  ctx.fillStyle = t.paperSoft;
  let sy = subTop;
  for (const l of subLines) {
    text(l, left, sy);
    sy += 46;
  }
  if (qr) {
    const qx = card.x + card.w - 56 - qrSize;
    const qy = bottom - qrSize;
    roundRect(ctx, qx - 12, qy - 12, qrSize + 24, qrSize + 24, 20);
    ctx.fillStyle = t.paper;
    ctx.fill();
    ctx.drawImage(qr, qx, qy, qrSize, qrSize);
    ctx.fillStyle = t.paperSoft;
    ctx.font = `700 36px ${t.body}`;
    ctx.textAlign = "right";
    const label = wrap(ctx, opts.qrLabel ?? "", qrSize + 120, 2);
    let ly = qy - 28 - (label.length - 1) * 44;
    for (const l of label) {
      text(l, qx + qrSize, ly);
      ly += 44;
    }
    ctx.textAlign = "left";
  }
  canvas.dataset.shareLines = JSON.stringify(drawn);
  if (opts.qrLink && qr) canvas.dataset.shareQr = opts.qrLink;
  else delete canvas.dataset.shareQr;
  return { lines: drawn };
}

/**
 * The "Our overlap" image after a pair session: both first names, a true count and up to three real
 * things Qloo found. Places are never handed in, and the same line check runs on every string.
 */
export async function drawOverlap(canvas: HTMLCanvasElement, share: OverlapShare, opts: { domains?: Domain[] } = {}): Promise<DrawResult> {
  const t = readTokens();
  await fontsReady(t);
  const { ctx, drawn, text } = session(canvas, share.things);
  const card = await cardTable(ctx, t, text);
  const left = card.x + 56;
  const inner = card.w - 112;
  let y = card.y + 320;

  ctx.fillStyle = t.paper;
  ctx.font = `900 72px ${t.display}`;
  for (const l of wrap(ctx, share.title, inner, 3)) {
    text(l, left, y);
    y += 80;
  }
  y += 20;
  ctx.fillStyle = t.paperSoft;
  ctx.font = `700 40px ${t.body}`;
  for (const l of wrap(ctx, share.count, inner, 2)) {
    text(l, left, y);
    y += 52;
  }
  y += 40;
  share.things.forEach((thing, i) => {
    const d = opts.domains?.[i];
    roundRect(ctx, left, y, inner, 120, 28);
    ctx.fillStyle = t.paper;
    ctx.fill();
    if (d) {
      ctx.beginPath();
      ctx.arc(left + 60, y + 60, 26, 0, Math.PI * 2);
      ctx.fillStyle = catColor(d);
      ctx.fill();
    }
    ctx.fillStyle = t.ink;
    ctx.font = `700 42px ${t.body}`;
    const [l] = wrap(ctx, thing, inner - 140, 1);
    text(l, left + (d ? 110 : 36), y + 74);
    y += 144;
  });
  ctx.fillStyle = t.paperSoft;
  ctx.font = `700 30px ${t.body}`;
  text("Found with Larry, from what real fans love", left, card.y + card.h - 64);
  canvas.dataset.shareLines = JSON.stringify(drawn);
  return { lines: drawn };
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/**
 * Share the image with the phone's share sheet when it takes files; otherwise save it as a file.
 * "shared" | "saved" | "cancelled" | "failed".
 */
export async function shareImage(blob: Blob, filename: string, title: string): Promise<"shared" | "saved" | "cancelled" | "failed"> {
  const file = new File([blob], filename, { type: "image/png" });
  try {
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return "saved";
  } catch {
    return "failed";
  }
}
