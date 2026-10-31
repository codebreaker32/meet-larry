import { codeHold, chargeCode, requireCode } from "@/lib/access";
import { runGroupChat } from "@/lib/agent";
import { RUN_ESTIMATE_USD, holdBudget } from "@/lib/budget";
import { groupCrisisResult, unansweredCrisis } from "@/lib/crisis";
import { BodyTooLargeError, codeBusyResponse, describeError, errorResponse, leaseCode, readBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recentPlacesFrom } from "@/lib/qloo";
import { larrySignalsSchema } from "@/lib/schemas";
import type { LarryEvent } from "@/lib/types";

// Solo chat with Larry ("Talk taste with Larry"): one person, a short capped session about their own
// taste, grounded in Qloo, that learns their persona and always ends at a Plan Ticket (or a First
// Step, or a room). Same NDJSON protocol as /api/chat; "done" carries a GroupChatResult plus
// planTicket and personaUpdate when there are any.

// The agent can make several Qloo calls per reply.
export const maxDuration = 60;

/** Bigger bodies than this are not a real conversation. */
const BODY_MAX = 1_000_000;

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
};

/** One NDJSON response from a function that emits events. */
function ndjson(run: (send: (e: LarryEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: LarryEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The client went away; nothing to tell.
        }
      };
      try {
        await run(send);
      } catch (err) {
        send({ type: "error", error: describeError(err).error });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

const tooBig = () => Response.json({ error: "That message didn't send. Try a shorter one." }, { status: 413 });

export async function POST(request: Request) {
  try {
    let raw: string;
    try {
      raw = await readBody(request, BODY_MAX);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return tooBig();
      throw err;
    }
    const json: unknown = JSON.parse(raw);

    // Possible crisis in any message since Larry last replied: help straight away, before rate
    // limits, setup or validation can turn the person away. No model call, so it costs nothing.
    if (unansweredCrisis(json)) {
      return ndjson(async (send) => send({ type: "done", result: groupCrisisResult() }));
    }

    const limited = rateLimit(request, "chat");
    if (limited) return limited;

    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return Response.json({ error: "Chat isn't set up yet. Try again later." }, { status: 503 });
    }
    // Every AI call is charged to the person's access code (401/402 here when it can't be).
    const access = await requireCode(request);
    if (access instanceof Response) return access;

    const { profile, history, location, stepsDone, persona, signals } = larrySignalsSchema.parse(json);
    const recentPlaces = recentPlacesFrom(json);

    // Holds this run's estimated cost (or answers 429 here, before the stream starts), charging
    // every model response to the code too.
    // One of a few runs at once on this code, reserved within its budget, so concurrent requests
    // can't all pass requireCode and overshoot it.
    const lease = await leaseCode(access.code, RUN_ESTIMATE_USD);
    if (!lease) return codeBusyResponse();
    let budget: ReturnType<typeof codeHold>;
    try {
      budget = codeHold(access.code, await holdBudget());
    } catch (err) {
      lease.release();
      throw err;
    }
    return ndjson(async (send) => {
      try {
        const result = await runGroupChat(
          {
            mode: "solo",
            members: [{ id: "me", name: profile.name, profile, color: "var(--film)" }],
            history,
            location,
            stepsDone,
            // "Talk taste with Larry": Larry uses the persona and the result carries personaUpdate.
            ...(persona ? { personas: { me: persona } } : {}),
            // The person's own mood, age range and Hidden Gems: shape Qloo and Larry's tone, never said back.
            ...(signals ? { signals } : {}),
            ...(recentPlaces.length ? { recentPlaces } : {}),
          },
          ({ tool, text }) => send({ type: "progress", tool, text }),
          { budget, signal: request.signal, charge: (usd) => chargeCode(access.code, usd) },
        );
        send({ type: "done", result });
      } finally {
        budget.release();
        lease.release();
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
}
