import { isDemoAccount } from "@/lib/account/session";
import { getRepo } from "@/lib/db";
import { demoNeedsSeed, openDemoGroups, seedDemoWorld } from "@/lib/groups/demo";
import { NO_STORE, createSchema, groundFinderFor, groupErrorResponse, readJson, requireSession, runAfter, takeLimit } from "@/lib/groups/http";
import { createGroup, listGroups } from "@/lib/groups/service";

// Larry's openings for the demo account's ready-made groups can run after the response.
export const maxDuration = 60;

/** GET /api/groups (18+ account) -> { groups }: the person's groups, newest activity first. No unread counts. */
export async function GET(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "poll");
    // The demo account only: its two ready-made groups with demo friends, made once if the deploy
    // seed (scripts/seed-demo.ts) hasn't already (always so with the in-memory database).
    const repo = getRepo();
    if (isDemoAccount(s) && (await demoNeedsSeed(repo, s.uid))) {
      await seedDemoWorld(repo, s.uid, { open: false });
      runAfter(async () => {
        const { find, charge, fake } = await groundFinderFor(request);
        await openDemoGroups(repo, s.uid, { find, ...(charge ? { charge } : {}), ...(fake ? { fixedOpener: true } : {}) });
      });
    }
    return Response.json({ groups: await listGroups(s.uid) }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

/** POST /api/groups { size: 2-5, profile, signals? } (18+ account) -> { group, join }: the group and its QR (15 minutes). */
export async function POST(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "create");
    const body = createSchema.parse(await readJson(request));
    return Response.json(await createGroup(s.uid, body), { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
