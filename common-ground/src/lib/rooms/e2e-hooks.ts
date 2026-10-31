import "server-only";
import type { GroupGround, GroupMember, RunGroupChat } from "@/lib/contracts";
import type { Deps as MeetDeps } from "@/lib/meet/service";

// Test hooks for the Playwright suite, so room tests never call the model or Qloo. They only work
// on a development server (`next dev`); in a production build NODE_ENV is "production" and every
// hook here returns undefined, so the headers are ignored.
//
//   x-e2e-larry: encodeURIComponent(JSON.stringify({ text, steps?, places?, echo? }))
//       on POST /api/rooms/[code]/messages: Larry's reply comes from the header instead of the model.
//       With echo: true, the reply also lists the people's lines Larry was given ("Read: a | b"),
//       so a test can check what reached Larry (for example, nothing sent while it was excused).
//       The rest of the room path (crisis check, limits, lock, history, cleaning) runs as normal.
//   x-e2e-fake-qloo: 1
//       on POST /api/rooms and /join: group common ground is built from the cards themselves
//       (shared picks, plus one fixed bridge) instead of asking Qloo.
//       On /api/meet/**: any well-formed place id is a public board-game café named
//       "E2E Board Game Cafe" at E2E_VENUE_LOCATION (give the browser that geolocation), and Qloo
//       bridges are empty (only picks both people chose count).

const enabled = () => process.env.NODE_ENV === "development";

/** A stand-in for runGroupChat that answers with the reply in the x-e2e-larry header. */
export function e2eLarry(request: Request): RunGroupChat | undefined {
  if (!enabled()) return undefined;
  const raw = request.headers.get("x-e2e-larry");
  if (!raw) return undefined;
  let reply: { text?: string; steps?: unknown[]; places?: unknown[]; echo?: boolean };
  try {
    reply = JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
  return async (input) => ({
    messages: reply.text
      ? [
          {
            from: "larry",
            text: reply.echo
              ? `${String(reply.text)} Read: ${input.history.filter((t) => t.role === "user").map((t) => t.content).join(" | ")}`
              : String(reply.text),
          },
        ]
      : [],
    quiet: !reply.text,
    steps: (Array.isArray(reply.steps) ? reply.steps : []) as never,
    profileUpdates: [],
    ...(Array.isArray(reply.places) ? { places: reply.places as never } : {}),
  });
}

/** A stand-in for findGroupCommonGround that makes no Qloo calls. */
export function e2eGround(request: Request): ((members: GroupMember[]) => Promise<GroupGround>) | undefined {
  if (!enabled() || request.headers.get("x-e2e-fake-qloo") !== "1") return undefined;
  return async (members) => {
    const byItem = new Map<string, { item: GroupMember["profile"]["items"][number]; memberIds: string[] }>();
    for (const m of members)
      for (const item of m.profile.items) {
        const entry = byItem.get(item.id) ?? { item, memberIds: [] };
        if (!entry.memberIds.includes(m.id)) entry.memberIds.push(m.id);
        byItem.set(item.id, entry);
      }
    const shared = [...byItem.values()].filter((s) => s.memberIds.length >= 2);
    const from = Object.fromEntries(members.filter((m) => m.profile.items[0]).map((m) => [m.id, [m.profile.items[0].name]]));
    return {
      shared,
      bridges:
        Object.keys(from).length >= 2
          ? [{ id: "e2e-goose", name: "Untitled Goose Game", domain: "videogame", affinity: 0.9, from }]
          : [],
    };
  };
}

/** Where the fake e2e venue is (central London). Tests set the browser's geolocation to it. */
export const E2E_VENUE_LOCATION = { lat: 51.5072, lon: -0.1276 };

/** Open to meet without Qloo: a fixed public café for any place id, and no Qloo bridges. */
export function e2eMeetDeps(request: Request): MeetDeps {
  if (!enabled() || request.headers.get("x-e2e-fake-qloo") !== "1") return {};
  return {
    fetchPlace: async (placeId) => ({
      entity_id: placeId,
      name: "E2E Board Game Cafe",
      types: ["urn:entity:place"],
      tags: [{ tag_id: "urn:tag:category:place:board_game_cafe" }],
      properties: { primary_genre: { id: "urn:tag:genre:place:cafe" } },
      location: E2E_VENUE_LOCATION,
    }),
    findGround: async () => ({ bridges: [] }),
  };
}
