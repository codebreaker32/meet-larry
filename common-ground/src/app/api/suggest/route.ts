import { z } from "zod";
import { type CodeLease, errorResponse, optionalLease, readJsonBody } from "@/lib/http";
import { findPlaces } from "@/lib/qloo";
import { clientIp, take } from "@/lib/rate-limit";
import { lineSchema, nextRungSignalsSchema, obstacleSchema, planBSignalsSchema, signalsSchema, suggestSignalsSchema } from "@/lib/schemas";
import { fallbackPlanB, fallbackSuggestions, nextRung, qlooPin, suggest, ticketExtras, writePlanB } from "@/lib/suggest";
import { nextRungFallback } from "@/lib/suggest-steps";

// Small Larry calls, each charged to the access code, each with a fixed answer when the model
// can't run (over the rate limit, no code, out of budget, or off-script):
//   kind "steps" | "nudges": AI-written First Step ideas or practice nudges (SuggestInput -> SuggestResult).
//   kind "next_rung": the next place on the Quiet-to-Lively ladder after a private check-in
//     (NextRungInput -> NextRungResult); the fixed table is the fallback.
//   kind "plan_b": an if-then plan B for a Plan Ticket worry (PlanBInput -> PlanBResult); for
//     "travel", Qloo is asked again within 1 km for a real, nearer place; for "loud", within 500 m
//     of the venue's own pin (sent as place.at, else looked up) for a calmer one.
//   kind "ticket": fills a Plan Ticket in (TicketExtrasInput -> TicketExtras): Amazon hours when
//     Qloo has none, the walking time from a coarse start, a second real stop in walking order, and
//     Larry's opener and route line. Works without a code too (no model lines then).
// Every kind takes the person's own `signals` (mood): low energy gets gentler, shorter lines.

/** Model calls per IP: a few at once, then one every 10 seconds, at most 60 a day. */
const SUGGEST_LIMIT = { burst: 6, refillPerSec: 1 / 10, daily: 60 };
const BODY_MAX = 20_000;
/** What one small Larry call is reserved against the access code (suggest.ts estimates are 2-3 cents). */
const SUGGEST_RESERVE_USD = 0.03;
const NO_STORE = { "Cache-Control": "no-store" } as const;

const idRe = /^[A-Za-z0-9-]{1,64}$/;
const nameRe = (max: number) => z.string().trim().min(1).max(max).transform((v) => v.replace(/[\p{C}<>{}\[\]]/gu, "").slice(0, max));
const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const vibe = z.enum(["calm", "cosy", "lively"]);

/** plan_b with every ticket worry ("loud" and "leave" too), the person's signals and the venue's pin. */
const planBTicketSchema = planBSignalsSchema.extend({
  obstacle: obstacleSchema,
  // The venue's own Qloo pin (PlaceCard.at, public business data): "too loud" searches around it.
  place: planBSignalsSchema.shape.place.extend({ at: latLon.optional() }),
});

/** "Too loud": a calmer place this close to the planned venue, so it really is a short walk. */
const CALMER_RADIUS_M = 500;

/** kind "ticket": only real ids and cleaned names; the start is coarse and never stored. */
const ticketSchema = z.object({
  kind: z.literal("ticket"),
  place: z.object({
    id: z.string().regex(idRe),
    name: nameRe(120),
    hours: z.string().max(200).optional(),
    slots: z.array(z.string().max(30)).max(6).optional(),
    vibe: vibe.optional(),
    tags: z.array(z.string().max(60)).max(10).optional(),
    reason: z.string().max(300).optional(),
    // The venue's own Qloo pin (PlaceCard.at, public business data), saving a lookup.
    at: latLon.optional(),
  }),
  item: z.object({ id: z.string().regex(idRe), name: nameRe(120) }).optional(),
  picks: z.array(z.string().regex(idRe)).max(30).optional(),
  opener: lineSchema().optional(),
  // Rounded to 2 decimals (about 1 km) here as well, whatever the phone sent.
  start: latLon.transform((p) => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 })).optional(),
  signals: signalsSchema.optional(),
  then: z.object({ id: z.string().regex(idRe), name: nameRe(120), vibe: vibe.optional(), reason: z.string().max(300).optional() }).optional(),
});

export async function POST(request: Request) {
  let lease: CodeLease | null = null;
  // A lease on the request's access code (a few runs at once, within its budget), else null.
  const optionalCharge = async () => (lease = await optionalLease(request, SUGGEST_RESERVE_USD))?.charge ?? null;
  try {
    const body = (await readJsonBody(request, BODY_MAX)) as { kind?: unknown };
    const allowed = take(`suggest:${clientIp(request)}`, SUGGEST_LIMIT);

    if (body?.kind === "ticket") {
      const { kind: _kind, ...input } = ticketSchema.parse(body);
      void _kind;
      // Over the limit: nothing new to add, and the ticket works as it is.
      if (!allowed) return Response.json({ fallback: true }, { headers: NO_STORE });
      const charge = await optionalCharge();
      return Response.json(await ticketExtras(input, { signal: request.signal, charge }), { headers: NO_STORE });
    }

    if (body?.kind === "next_rung") {
      const { kind: _kind, signals: _signals, ...input } = nextRungSignalsSchema.parse(body);
      void _kind;
      void _signals;
      if (!allowed) return Response.json(nextRungFallback(input), { headers: NO_STORE });
      const charge = await optionalCharge();
      if (!charge) return Response.json(nextRungFallback(input), { headers: NO_STORE });
      return Response.json(await nextRung(input, { signal: request.signal, charge }), { headers: NO_STORE });
    }

    if (body?.kind === "plan_b") {
      const { kind: _kind, signals, ...rest } = planBTicketSchema.parse(body);
      void _kind;
      const { at: _at, ...placeOnly } = rest.place;
      void _at;
      const input = { ...rest, place: placeOnly, ...(signals?.mood ? { mood: signals.mood } : {}) };
      const venuePin = rest.place.at;
      if (!allowed) return Response.json({ planB: fallbackPlanB(input), fallback: true }, { headers: NO_STORE });
      // "Can't get there": ask Qloo again, within 1 km of the person, for a real nearer place.
      // "Too loud": the same kind of place, calmer, a short walk away.
      let nearer: { id: string; name: string; distanceKm?: number } | undefined;
      const signal = input.item ? [input.item, ...(input.picks ?? []).map((id) => ({ id, name: id }))] : (input.picks ?? []).map((id) => ({ id, name: id }));
      if (input.obstacle === "travel" && input.location && signal.length) {
        const found = await findPlaces(signal.slice(0, 10), input.location.lat, input.location.lon, {
          radius: 1000,
          maxRadius: 1000,
          exclude: [input.place.id],
          take: 4,
          ...(signals ? { signals } : {}),
        }).catch(() => []);
        const near = found.find((p) => p.vibe !== "lively") ?? found[0];
        if (near) nearer = { id: near.id, name: near.name, ...(near.distanceKm !== undefined ? { distanceKm: near.distanceKm } : {}) };
      }
      if (input.obstacle === "loud" && signal.length) {
        // Around the venue they'll be standing in, not where they searched from (that can be km away).
        const place = input.place;
        const pin = venuePin ?? (await qlooPin(place.id).catch(() => null));
        const found = pin
          ? await findPlaces(signal.slice(0, 10), pin.lat, pin.lon, {
              radius: CALMER_RADIUS_M,
              maxRadius: CALMER_RADIUS_M,
              exclude: [place.id],
              take: 6,
              ...(signals ? { signals } : {}),
            }).catch(() => [])
          : [];
        const quiet = found.find((p) => p.vibe === "calm") ?? found.find((p) => p.vibe === "cosy" && place.vibe !== "cosy");
        if (quiet) nearer = { id: quiet.id, name: quiet.name };
      }
      const charge = await optionalCharge();
      if (!charge) return Response.json({ planB: fallbackPlanB(input, nearer), ...(nearer ? { nearer } : {}), fallback: true }, { headers: NO_STORE });
      return Response.json(await writePlanB(input, nearer, { signal: request.signal, charge }), { headers: NO_STORE });
    }

    const { signals, obstacle: _obstacle, opener: _opener, ...input } = suggestSignalsSchema.parse(body);
    void _obstacle;
    void _opener;
    // Over the limit: the fixed suggestions still help, and cost nothing.
    if (!allowed) return Response.json(fallbackSuggestions(input), { headers: NO_STORE });
    // The model's cost is charged to the access code; without a usable code, the fixed suggestions.
    const charge = await optionalCharge();
    if (!charge) return Response.json(fallbackSuggestions(input), { headers: NO_STORE });
    const result = await suggest(input, { signal: request.signal, charge, ...(signals?.mood ? { mood: signals.mood } : {}) });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  } finally {
    (lease as CodeLease | null)?.release();
  }
}
