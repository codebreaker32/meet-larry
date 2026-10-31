// The nudge cap (D8, D17) and plan-reminder timing. Pure: no storage, no clock of its own.
// Rules: at most 1 nudge a day per person, at most 1 a week about the same friend or place, never in
// quiet hours (21:00-09:00 in India time), and none at all when the age is unknown or 13-17.
// Plan reminders are not nudges (the person asked for exactly one), but they also never land in
// quiet hours: reminderAt() moves them into the day.
import { isAdultBucket, type AgeBucket } from "./types/signals";

/** India time: the whole hackathon audience. Fixed offset, no DST. */
export const NUDGE_TZ_OFFSET_MIN = 5 * 60 + 30;
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 9;
export const NUDGES_PER_DAY = 1;
/** Same friend or place: at most once in this window. */
export const SAME_TARGET_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** A plan reminder goes this long before the plan. */
export const REMINDER_LEAD_MS = 2 * HOUR_MS;
/** ...but never less than this before it (it would be too late to "move it"). */
export const REMINDER_MIN_LEAD_MS = 30 * 60 * 1000;
/** Plans further out than this get no reminder (the ticket is a small step, not a calendar). */
export const REMINDER_MAX_AHEAD_MS = 14 * DAY_MS;

/** Wall-clock parts in India time. */
export function localParts(ms: number): { day: number; hour: number; minute: number; dateKey: string } {
  const d = new Date(ms + NUDGE_TZ_OFFSET_MIN * 60_000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), dateKey: d.toISOString().slice(0, 10) };
}

/** ms for a local (India) date and time. */
function localToMs(dateKey: string, hour: number, minute = 0): number {
  return Date.parse(`${dateKey}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - NUDGE_TZ_OFFSET_MIN * 60_000;
}

export function inQuietHours(ms: number): boolean {
  const { hour } = localParts(ms);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Who may get nudges at all: only a known adult age. Unknown age and 13-17 get none (D17). */
export function nudgeAllowedFor(age: AgeBucket | "adult" | null | undefined): boolean {
  return age === "adult" || isAdultBucket(age as AgeBucket | undefined);
}

export interface NudgeLog {
  /** When each nudge went out (ms), any order. */
  sentAt: number[];
  /** Target key ("place:<id>", "friend:<id>", "weekly") -> last nudge about it (ms). */
  byTarget?: Record<string, number>;
  /** Targets the person muted. */
  muted?: string[];
}

export type NudgeDecision = { ok: true } | { ok: false; reason: "age" | "quiet" | "daily" | "target" | "muted" };

/** May one nudge about `target` go out at `now`? */
export function canNudge(
  log: NudgeLog,
  opts: { now: number; age: AgeBucket | "adult" | null | undefined; target?: string },
): NudgeDecision {
  if (!nudgeAllowedFor(opts.age)) return { ok: false, reason: "age" };
  if (opts.target && log.muted?.includes(opts.target)) return { ok: false, reason: "muted" };
  if (inQuietHours(opts.now)) return { ok: false, reason: "quiet" };
  const today = localParts(opts.now).dateKey;
  const sentToday = log.sentAt.filter((t) => localParts(t).dateKey === today && t <= opts.now).length;
  if (sentToday >= NUDGES_PER_DAY) return { ok: false, reason: "daily" };
  const last = opts.target ? log.byTarget?.[opts.target] : undefined;
  if (last !== undefined && opts.now - last < SAME_TARGET_MS) return { ok: false, reason: "target" };
  return { ok: true };
}

/** The log after one nudge went out. Keeps only the last 8 days. */
export function recordNudge(log: NudgeLog, now: number, target?: string): NudgeLog {
  const keep = now - 8 * DAY_MS;
  const byTarget = Object.fromEntries(Object.entries(log.byTarget ?? {}).filter(([, t]) => t > keep));
  if (target) byTarget[target] = now;
  return { ...log, sentAt: [...log.sentAt.filter((t) => t > keep), now], byTarget };
}

/* ------------------------------------------------------------------ weekly move time */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The person's chosen weekly slot, India time. Hours inside quiet hours are refused by validWeekly. */
export interface WeeklySlot {
  /** 0 = Sunday. */
  day: number;
  hour: number;
}

/** The offered slots: daytime, weekend-leaning, inside the allowed hours. */
export const WEEKLY_CHOICES: readonly WeeklySlot[] = [
  { day: 6, hour: 10 },
  { day: 0, hour: 11 },
  { day: 5, hour: 18 },
  { day: 3, hour: 18 },
];

export const validWeekly = (s: WeeklySlot): boolean =>
  Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 && Number.isInteger(s.hour) && s.hour >= QUIET_END_HOUR && s.hour < QUIET_START_HOUR;

export function weeklyLabel(s: WeeklySlot): string {
  const h = s.hour % 12 || 12;
  return `${WEEKDAYS[s.day]} ${h}${s.hour < 12 ? "am" : "pm"}`;
}

/** True during the chosen hour, if this week's push hasn't gone yet (lastSent more than 6 days ago). */
export function weeklyDue(slot: WeeklySlot, now: number, lastSent?: number): boolean {
  if (!validWeekly(slot)) return false;
  const p = localParts(now);
  if (p.day !== slot.day || p.hour !== slot.hour) return false;
  return lastSent === undefined || now - lastSent > 6 * DAY_MS;
}

/* ------------------------------------------------------------------ plan reminders */

const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * The next time a ticket's `when` label means, India time: "Sat 11am", "Sun 3:30pm", "Today 4pm",
 * "Tomorrow 10am". Null when the label has no clear day and time (then no reminder is offered).
 */
export function whenToMs(label: string, now: number): number | null {
  const m = /^\s*(sun|mon|tue|wed|thu|fri|sat|today|tomorrow)[a-z]*\.?,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$/i.exec(label);
  if (!m) return null;
  let hour = Number(m[2]) % 12;
  if (m[4].toLowerCase() === "pm") hour += 12;
  const minute = Number(m[3] ?? 0);
  if (minute > 59) return null;
  const word = m[1].toLowerCase();
  const p = localParts(now);
  let addDays: number;
  if (word === "today") addDays = 0;
  else if (word === "tomorrow") addDays = 1;
  else addDays = (DAY_WORDS[word.slice(0, 3)] - p.day + 7) % 7;
  const base = Date.parse(`${p.dateKey}T00:00:00Z`) + addDays * DAY_MS;
  let at = localToMs(new Date(base).toISOString().slice(0, 10), hour, minute);
  // "Sat 11am" said on Saturday at noon means next Saturday.
  if (at <= now && word !== "today") at += 7 * DAY_MS;
  return at > now ? at : null;
}

/**
 * When to send the one reminder for a plan at `planAt`: 2 hours before, moved out of quiet hours.
 * A late reminder moves back to 20:30; an early one moves to 09:00 that morning, or to 20:30 the
 * evening before when 09:00 is too close to the plan. Null when there is no good time.
 */
export function reminderAt(planAt: number, now: number): number | null {
  if (planAt - now > REMINDER_MAX_AHEAD_MS) return null;
  let at = planAt - REMINDER_LEAD_MS;
  if (inQuietHours(at)) {
    const p = localParts(at);
    // After 21:00: pull back to 20:30 the same evening. Before 09:00: try 09:00 that morning.
    if (p.hour >= QUIET_START_HOUR) at = localToMs(p.dateKey, 20, 30);
    else {
      const morning = localToMs(p.dateKey, QUIET_END_HOUR);
      at = planAt - morning >= REMINDER_MIN_LEAD_MS ? morning : localToMs(new Date(Date.parse(`${p.dateKey}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10), 20, 30);
    }
  }
  if (planAt - at < REMINDER_MIN_LEAD_MS) return null;
  if (at <= now) {
    // Already inside the lead window: remind soon, if that's still useful and not in quiet hours.
    const soon = now + 60_000;
    return planAt - soon >= REMINDER_MIN_LEAD_MS && !inQuietHours(soon) ? soon : null;
  }
  return at;
}
