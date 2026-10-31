import { codeHold, chargeCode, requireCode } from "@/lib/access";
import { practicePartner, runPairChat } from "@/lib/agent";
import { RUN_ESTIMATE_USD, holdBudget } from "@/lib/budget";
import type { ChatEvent } from "@/lib/chat-protocol";
import { crisisResult, unansweredCrisis } from "@/lib/crisis";
import { findPersona } from "@/lib/demo";
import { BodyTooLargeError, codeBusyResponse, describeError, errorResponse, leaseCode, readBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { recentPlacesFrom } from "@/lib/qloo";
import { chatSignalsSchema } from "@/lib/schemas";

// The agent can make several Qloo calls per reply.
export const maxDuration = 60;

/** Bigger bodies than this are not a real conversation. */
const BODY_MAX = 1_000_000;

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
};

/** One NDJSON response from a function that emits events. */
function ndjson(run: (send: (e: ChatEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => {
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

    // Possible crisis: answer with help straight away, before rate limits, setup or validation
    // can turn the person away. The model is not called, so this costs nothing.
    if (unansweredCrisis(json)) {
      return ndjson(async (send) => send({ type: "done", result: crisisResult() }));
    }

    const limited = rateLimit(request, "chat");
    if (limited) return limited;

    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return Response.json({ error: "Chat isn't set up yet. Try again later." }, { status: 503 });
    }
    // Every AI call is charged to the person's access code (401/402 here when it can't be).
    const access = await requireCode(request);
    if (access instanceof Response) return access;

    // `signals`: the phone owner's own mood, age range and Hidden Gems (never said back to anyone).
    const { persona: personaId, ...body } = chatSignalsSchema.parse(json);
    const recentPlaces = recentPlacesFrom(json);
    // A practice character's tastes come from the server, never from the request.
    const persona = findPersona(personaId);
    if (personaId && !persona) return Response.json({ error: "That practice partner isn't here." }, { status: 400 });

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
        const result = await runPairChat({
          ...body,
          // Practice characters' ground was computed against the request's b, so don't trust it.
          ground: persona ? undefined : body.ground,
          // The persona's own picks, plus any add_interest gave them earlier this round.
          b: persona ? practicePartner(persona, body.b) : body.b,
          persona,
          recentPlaces,
          budget,
          charge: (usd) => chargeCode(access.code, usd),
          signal: request.signal,
          onProgress: ({ tool, text }) => send({ type: "progress", tool, text }),
        });
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
