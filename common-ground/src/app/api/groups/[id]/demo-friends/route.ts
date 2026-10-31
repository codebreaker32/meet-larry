import { z } from "zod";
import { getRepo } from "@/lib/db";
import { demoFriendOptions, demoFriendScan, postDemoReply } from "@/lib/groups/demo";
import { type IdParams, NO_STORE, groundFinderFor, groupErrorResponse, groupIdFrom, readJson, requireSession, runAfter, takeLimit } from "@/lib/groups/http";
import { openGroup, readGroup } from "@/lib/groups/service";

// Larry's opening (Qloo and one curation call) can run after the response.
export const maxDuration = 60;

// "Let a demo friend scan it" (next-round-queue.md, "Demo friends for judges"). Only the demo
// account (isDemoAccount: the verified phone claim) that started this group, while its QR is live,
// gets an answer. Every other account gets the same plain 404, as if the route weren't there.

const bodySchema = z.object({ friend: z.string().max(20) });

/** GET /api/groups/[id]/demo-friends -> { friends }: demo friends who can scan this QR now. */
export async function GET(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "poll");
    const id = await groupIdFrom(ctx);
    return Response.json({ friends: await demoFriendOptions(getRepo(), s, id) }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

/**
 * POST /api/groups/[id]/demo-friends { friend } -> { group, messages }: that demo friend joins as if
 * they had scanned the QR. When the group fills, Larry opens it, then the friend says one short line.
 */
export async function POST(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "join");
    const id = await groupIdFrom(ctx);
    const { friend } = bodySchema.parse(await readJson(request));
    const repo = getRepo();
    const { formed, friend: key } = await demoFriendScan(repo, s, id, friend);
    if (formed) {
      runAfter(async () => {
        const { find, charge, fake } = await groundFinderFor(request);
        if (await openGroup(id, { find, ...(charge ? { charge } : {}), ...(fake ? { fixedOpener: true } : {}) }, repo)) await postDemoReply(repo, id, key);
      });
    }
    return Response.json(await readGroup(s.uid, id, {}, repo), { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
