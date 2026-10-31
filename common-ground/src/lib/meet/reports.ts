import "server-only";
import { REPORT_MESSAGES, REPORT_TTL_MS, type ReportReason } from "./config";
import { newReportId } from "./crypto";
import type { Identity } from "./blocks";
import { getMeetKv } from "./kv";

// Reports are kept for review for 30 days: the reason, who (as hashes) and, from a chat, the last
// messages. No venue, time of visit or location is stored with them.

export interface ReportMessage {
  /** "reported", "reporter", "larry" or "other": the review needs who said what, not names. */
  from: "reported" | "reporter" | "larry" | "other";
  text: string;
}

export interface StoredReport {
  id: string;
  at: number;
  reason: ReportReason;
  note?: string;
  where: "nearby" | "meet-chat" | "room";
  reporter: Identity;
  reported: Identity;
  messages: ReportMessage[];
}

const INDEX = "report:index";
const INDEX_MAX = 2_000;

export async function addReport(r: Omit<StoredReport, "id" | "at">): Promise<string> {
  const kv = getMeetKv();
  const report: StoredReport = { ...r, id: newReportId(), at: Date.now(), messages: r.messages.slice(-REPORT_MESSAGES) };
  await kv.update(`report:${report.id}`, () => report, REPORT_TTL_MS);
  await kv.update<string[]>(INDEX, (cur) => [...(cur ?? []), report.id].slice(-INDEX_MAX), REPORT_TTL_MS);
  return report.id;
}

/** Reports waiting for review, newest first (for a review script; no HTTP route exposes them). */
export async function listReports(limit = 50): Promise<StoredReport[]> {
  const kv = getMeetKv();
  const ids = ((await kv.get<string[]>(INDEX)) ?? []).slice(-limit).reverse();
  const all = await Promise.all(ids.map((id) => kv.get<StoredReport>(`report:${id}`)));
  return all.filter((r): r is StoredReport => !!r);
}
