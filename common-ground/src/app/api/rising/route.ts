import { getRising, risingMiss } from "@/lib/rising";

// GET /api/rising -> { items: [], miss }. Qloo has no verified per-city trend, so this answers
// honestly with nothing, and never "rising in <city>"; `miss` is the line Larry says instead, which
// offers a plan. The "Big near you" picture row is a different route (/api/big-near-you).
export async function GET() {
  return Response.json({ items: await getRising(), miss: risingMiss() }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
