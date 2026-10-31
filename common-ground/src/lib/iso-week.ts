// ISO weeks ("2026-W44"), for Spot weeks. Pure, shared by server and client. Weeks start on Monday;
// week 1 is the week with the year's first Thursday. Local time on the device is what counts: a visit
// on Saturday evening belongs to that Saturday's week wherever the person is.
import type { IsoWeek } from "./types/checkin";

export type { IsoWeek };

const DAY_MS = 24 * 60 * 60 * 1000;
const RE = /^(\d{4})-W(\d{2})$/;

/** The ISO week a local date falls in, e.g. isoWeek(new Date(2026, 9, 31)) is "2026-W44". */
export function isoWeek(date: Date): IsoWeek {
  // Thursday of this week decides the year (local calendar day, read as UTC so DST can't shift it).
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(day + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of an ISO week, as a day number; null for a malformed week. */
function mondayOf(week: IsoWeek): number | null {
  const m = RE.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > 53) return null;
  // Jan 4th is always in week 1.
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY_MS + (n - 1) * 7 * DAY_MS;
}

export const isIsoWeek = (s: unknown): s is IsoWeek => typeof s === "string" && mondayOf(s) !== null;

/** Whole weeks from `a` to `b` (negative when b is earlier). NaN for a malformed week. */
export function weeksBetween(a: IsoWeek, b: IsoWeek): number {
  const x = mondayOf(a);
  const y = mondayOf(b);
  if (x === null || y === null) return NaN;
  return Math.round((y - x) / (7 * DAY_MS));
}
