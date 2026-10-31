import { getRepo } from "@/lib/db";
import { randomAlias } from "@/lib/alias";
import { errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import type { UsernameResponse } from "@/lib/types/account";

/** GET /api/account/username -> { username }: a fresh public-safe name nobody has yet. Call again to re-roll. */
export async function GET(request: Request) {
  // Outside the try: reading the request marks this route dynamic, and that signal must not be caught.
  const limited = rateLimit(request, "qloo");
  if (limited) return limited;
  try {
    const repo = getRepo();
    let username = randomAlias();
    for (let i = 0; i < 5 && (await repo.usernames.owner(username)); i++) username = randomAlias();
    const body: UsernameResponse = { username };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
