// Glory: a lifetime score earned only by verified real-world actions. Never from chat, app opens or
// money. Never goes down (The Earned Outside Rule, D3).

export type GloryEvent = "visit" | "plan-both-attended" | "met-friend" | "said-hi";

export const GLORY_RULES = {
  /** A verified visit (arrive and leave 20+ minutes apart, one per place per day). */
  visit: 10,
  /** STRETCH (needs co-presence, D15): both people attended a plan. */
  "plan-both-attended": 20,
  /** STRETCH (needs co-presence, D15): met a friend at a place. */
  "met-friend": 15,
  /** Honour tap "We said hi" on a verified leave. */
  "said-hi": 5,
} as const satisfies Record<GloryEvent, number>;

/** Events live tonight; the others wait for co-presence (D15). */
export const GLORY_LIVE_EVENTS = ["visit", "said-hi"] as const satisfies readonly GloryEvent[];

/** Glory added for a set of events. Always 0 or more. */
export function gloryFor(events: readonly GloryEvent[]): number {
  return events.reduce((sum, e) => sum + Math.max(0, GLORY_RULES[e]), 0);
}
