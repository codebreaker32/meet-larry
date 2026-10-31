import { z } from "zod";
import { NO_STORE, groupErrorResponse, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { block, report, unfriend } from "@/lib/groups/service";
import { GROUP_REPORT_REASONS, GROUP_WORD } from "@/lib/groups/shared";
import { getRepo } from "@/lib/db";
import { friendByUsername, listFriends } from "@/lib/people/friends";

// Friends come only from groups (D26): whoever you share a group with. No invites, requests, search
// or follow. Every action here is silent and immediate. People are named by username, never by uid.

const handle = z.string().regex(/^[\w:-]{1,128}$/);

/** GET /api/friends (18+ account) -> { friends: [{ username, uid (= username), displayName, sharing, groupIds }] } */
export async function GET(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "poll");
    // `uid` repeats the username for older clients that key friends by it; the real uid is never sent.
    const friends = (await listFriends(s.uid)).map((f) => ({ ...f, uid: f.username }));
    return Response.json({ friends }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

/** PUT /api/friends { sharing } -> { ok }: "Show my check-ins to friends" (off by default). */
export async function PUT(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const { sharing } = z.object({ sharing: z.boolean() }).parse(await readJson(request));
    await getRepo().accounts.update(s.uid, (a) => ({ ...a, sharingWithFriends: sharing }));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

/** DELETE /api/friends { username } (or { uid } holding the username) -> { ok }: unfriend = leave every shared group. */
export async function DELETE(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const body = z.object({ username: handle.optional(), uid: handle.optional() }).parse(await readJson(request));
    const name = body.username ?? body.uid;
    const other = name ? await friendByUsername(s.uid, name) : null;
    // Not a friend (or never was): nothing to do, and the same answer, so nothing is revealed.
    if (other) await unfriend(s.uid, other);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unfriend"), username: handle }),
  z.object({ action: z.literal("block"), username: handle }),
  z.object({ action: z.literal("report"), username: handle, reason: z.enum(GROUP_REPORT_REASONS), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("accept"), code: z.string().max(64) }),
]);

/** POST /api/friends { action: "unfriend" | "block" | "report", username, reason? } -> { ok }. From a friend's profile. */
export async function POST(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const body = postSchema.parse(await readJson(request));
    if (body.action === "invite" || body.action === "accept") {
      return Response.json({ error: `Friends start with a ${GROUP_WORD.toLowerCase()} QR now. Start one and show it.` }, { status: 410, headers: NO_STORE });
    }
    const other = await friendByUsername(s.uid, body.username);
    if (other) {
      if (body.action === "unfriend") await unfriend(s.uid, other);
      else if (body.action === "block") await block(s.uid, other);
      else await report(s.uid, other, { reason: body.reason, ...(body.note ? { note: body.note } : {}) });
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
