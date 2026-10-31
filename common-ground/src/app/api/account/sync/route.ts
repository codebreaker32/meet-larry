import { putSync } from "@/lib/account/service";
import { getSession } from "@/lib/account/session";
import { getRepo } from "@/lib/db";
import { errorResponse, readJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { SYNC_MAX_BYTES, syncBlobSchema } from "@/lib/schemas";
import type { SyncBlob } from "@/lib/types/account";

// /api/account/sync (bearer). Folded counts only (D11): the schema keeps SyncedPlaceCounter fields
// and drops step times, so no visit history ever reaches the server. The client debounces it to
// at most once a day and never fires it from the leave tap.

const NO_STORE = { "Cache-Control": "no-store" } as const;
const EMPTY: SyncBlob = { persona: null, steps: [], placeCounters: [] };

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const session = await getSession(request);
    if (!session) return Response.json({ error: "Sign in to sync." }, { status: 401, headers: NO_STORE });
    return Response.json((await getRepo().sync.get(session.uid)) ?? EMPTY, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const session = await getSession(request);
    if (!session) return Response.json({ error: "Sign in to sync." }, { status: 401, headers: NO_STORE });
    const blob = syncBlobSchema.parse(await readJsonBody(request, SYNC_MAX_BYTES + 10_000)) as SyncBlob;
    await putSync(session.uid, blob);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
