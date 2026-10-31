import { z } from "zod";
import { MESSAGE_MAX } from "./chat-protocol";
import { cleanItemName, cleanName } from "./sanitize";
import { type Domain, DOMAIN_KEYS } from "./types";
import { isGeneratedName, PODIUM_HEX_RE } from "./alias";
import { AGE_BUCKETS, MOODS } from "./types/signals";
import { PUBLIC_TITLES, STAGES } from "./types/titles";

// Request bodies come from the browser (and QR links), so validate everything. Names are
// attacker-controlled text that reaches the model, so they are cleaned here, once.

const domainSchema = z.enum(DOMAIN_KEYS as [Domain, ...Domain[]]);
/** Qloo entity ids are UUIDs; allow a little more, but nothing that could carry text. */
const idSchema = z.string().regex(/^[\w.:-]{1,64}$/);
const itemNameSchema = z.string().max(300).transform(cleanItemName);

/** Items whose name is empty after cleaning are dropped, not rejected. */
const keepNamed = <T extends { name: string }>(items: T[]) => items.filter((i) => i.name);

/** Most picks a profile may carry in a request. add_interest stops adding at this size too. */
export const PROFILE_ITEMS_MAX = 20;
const IMAGE_MAX = 300;
const imageSchema = z.string().url().startsWith("https://").max(IMAGE_MAX);

/** An image URL that request validation will accept, else undefined (so the item still fits). */
export function safeImage(url: string | undefined): string | undefined {
  return url && imageSchema.safeParse(url).success ? url : undefined;
}

export const tasteItemSchema = z.object({
  id: idSchema,
  name: itemNameSchema,
  domain: domainSchema,
  image: imageSchema.optional(),
});

export const profileSchema = z.object({
  name: z
    .string()
    .max(200)
    .transform((n) => cleanName(n) || "Friend"),
  items: z.array(tasteItemSchema).max(PROFILE_ITEMS_MAX).transform(keepNamed),
});

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const pairSchema = z.object({ a: profileSchema, b: profileSchema });

// ---------------------------------------------------------------- persona

/** Longest note Larry keeps about someone ("prefers calm places"). */
export const NOTE_MAX = 100;
/** Likes accepted in a request (the app keeps more; the newest are sent). */
const PERSONA_LIKES_ACCEPT = 300;

/**
 * One line of plain text (a persona note, Larry's reason for a bridge): no control characters,
 * brackets or markup, no links and no long numbers (phone numbers), at most `max` characters.
 */
export function cleanLine(raw: string, max = NOTE_MAX): string {
  return raw
    .slice(0, max * 3)
    .normalize("NFC")
    .replace(/(?!\u200d)[\p{C}]/gu, " ")
    .replace(/[<>{}\[\]`\\|]/g, "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\d{5,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** A persona note. */
export const cleanNote = (raw: string) => cleanLine(raw, NOTE_MAX);

const vibeSchema = z.enum(["calm", "cosy", "lively"]);

/**
 * Larry's saved picture of someone's taste (contracts.ts Persona), sent with chat requests. All of
 * it reaches the model inside a data block, so names and notes are cleaned like card names.
 */
export const personaSchema = z.object({
  version: z.literal(1),
  name: z
    .string()
    .max(200)
    .transform((n) => cleanName(n) || "Friend"),
  likes: z
    .array(tasteItemSchema)
    .max(PERSONA_LIKES_ACCEPT)
    .transform(keepNamed),
  dislikes: z
    .array(z.object({ name: itemNameSchema, id: idSchema.optional(), domain: domainSchema.optional() }))
    .max(60)
    .transform((d) => keepNamed(d).slice(0, 40)),
  notes: z
    .array(z.string().max(400).transform(cleanNote))
    .max(40)
    .transform((n) => n.filter(Boolean).slice(0, 20)),
  placeVibe: vibeSchema.optional(),
  updatedAt: z.number().int().min(0),
});

const creditSchema = z
  .array(itemNameSchema)
  .max(5)
  .transform((names) => names.filter(Boolean).slice(0, 2));

export const bridgeSchema = z.object({
  id: idSchema,
  name: itemNameSchema,
  domain: domainSchema,
  image: imageSchema.optional(),
  affinity: z.number().min(0).max(1),
  fromA: creditSchema,
  fromB: creditSchema,
  scoreA: z.number().min(0).max(1).optional(),
  scoreB: z.number().min(0).max(1).optional(),
  /** Larry's reason it fits both: shown to the people and given back to the model, so cleaned. */
  why: z
    .string()
    .max(400)
    .transform((w) => cleanLine(w, 200) || undefined)
    .optional(),
});

/** Common ground the client already has, so the opening reply can skip a Qloo round trip. */
export const groundSchema = z.object({
  shared: z.array(tasteItemSchema).max(20).transform(keepNamed),
  bridges: z
    .array(bridgeSchema)
    .max(40)
    .transform((b) => keepNamed(b).slice(0, 8)),
});

/** Longest history turn kept, per role. Longer text is cut, never rejected. */
const TURN_MAX = { user: MESSAGE_MAX * 2, assistant: 2000 } as const;
/** Turns accepted from the client; only the last HISTORY_TURNS reach the model. */
const HISTORY_ACCEPT = 200;

const turnSchema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string() })
  .transform((t) => ({ role: t.role, content: t.content.slice(0, TURN_MAX[t.role]) }));

/** Chat history from the client: the last HISTORY_ACCEPT turns, each cut to TURN_MAX. */
export const historySchema = z.preprocess(
  (v) => (Array.isArray(v) ? v.slice(-HISTORY_ACCEPT) : v),
  z.array(turnSchema).transform((h) => h.slice(-HISTORY_ACCEPT)),
);

/** Real-world First Steps marked done on this phone (0-50; more counts as 50). */
const stepsDoneSchema = z.number().int().min(0).transform((n) => Math.min(n, 50));

export const chatSchema = pairSchema.extend({
  history: historySchema,
  location: locationSchema.optional(),
  persona: z.string().max(20).optional(),
  ground: groundSchema.optional(),
  /** Real-world First Steps marked done on this phone (0-50; more counts as 50). Shortens practice rounds (the fade). */
  stepsDone: stepsDoneSchema.optional(),
  /** This phone owner's persona, so Larry can use and update it (the result carries personaUpdate). */
  myPersona: personaSchema.optional(),
  /** Which seat the phone owner sits in (default "a"). */
  mySeat: z.enum(["a", "b"]).optional(),
});

/** POST /api/larry: one person chatting with Larry (solo). */
export const larrySchema = z.object({
  profile: profileSchema,
  history: historySchema,
  location: locationSchema.optional(),
  /** Shortens the session as real-world steps get done (the fade, practiceTurnsFor). */
  stepsDone: stepsDoneSchema.optional(),
  /** "Talk taste with Larry": the person's persona, which Larry uses and keeps improving. */
  persona: personaSchema.optional(),
});

/** POST /api/common-ground: two cards, and optional personas so Larry can skip what someone dislikes. */
export const commonGroundSchema = pairSchema.extend({
  personas: z.object({ a: personaSchema.optional(), b: personaSchema.optional() }).optional(),
});

/** POST /api/suggest: only real names reach the model, all cleaned. */
export const suggestSchema = z.object({
  names: z
    .array(z.string().max(200).transform(cleanName))
    .max(5)
    .transform((n) => n.filter(Boolean)),
  picks: z
    .array(itemNameSchema)
    .max(30)
    .transform((n) => [...new Set(n.filter(Boolean))].slice(0, 12)),
  bridges: z
    .array(itemNameSchema)
    .max(30)
    .transform((n) => [...new Set(n.filter(Boolean))].slice(0, 8)),
  places: z
    .array(z.object({ name: itemNameSchema, kind: z.string().max(80).transform(cleanItemName).optional() }))
    .max(10)
    .transform((p) => keepNamed(p).slice(0, 4)),
  kind: z.enum(["steps", "nudges"]),
});

/** POST /api/suggest kind "next_rung" (NextRungInput): Larry picks the next ladder place. */
export const nextRungSchema = z.object({
  kind: z.literal("next_rung"),
  step: z.object({
    text: z.string().max(200).transform(cleanItemName),
    placeId: idSchema.optional(),
    placeName: itemNameSchema.optional(),
    vibe: vibeSchema.optional(),
  }),
  feeling: z.enum(["good", "okay", "hard"]),
  reason: z.enum(["too_loud", "no_one", "cant_find", "loved"]).optional(),
  candidates: z
    .array(
      z.object({
        id: idSchema,
        name: itemNameSchema,
        vibe: vibeSchema,
        tags: z.array(z.string().max(60).transform(cleanItemName)).max(10).optional(),
        about: z.string().max(400).transform(cleanItemName).optional(),
      }),
    )
    .max(20)
    .transform((c) => keepNamed(c).slice(0, 10)),
  persona: z
    .object({
      picks: z.array(itemNameSchema).max(30).transform((n) => n.filter(Boolean).slice(0, 10)),
      placeVibe: vibeSchema.optional(),
    })
    .optional(),
});

/** POST /api/suggest kind "plan_b" (PlanBInput): Larry writes a plan B; "travel" asks Qloo for a nearer place. */
export const planBSchema = z.object({
  kind: z.literal("plan_b"),
  obstacle: z.enum(["nervous", "words", "alone", "travel"]),
  place: z.object({
    id: idSchema,
    name: itemNameSchema,
    vibe: vibeSchema.optional(),
    tags: z.array(z.string().max(60).transform(cleanItemName)).max(10).optional(),
  }),
  item: z.object({ id: idSchema, name: itemNameSchema }).optional(),
  picks: z.array(idSchema).max(30).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
});

const placeItemSchema = z.object({ id: idSchema, name: itemNameSchema });

/** A person places are judged for: an id ("a", "b", a member id or "me"), their card, and optionally their persona. */
const placeMemberSchema = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  profile: profileSchema,
  persona: personaSchema.optional(),
});

/**
 * POST /api/places. Either `items: {id, name}[]` (the names give each place a reason), or
 * `members` (1-5 people), whose picks are the signal and who each get a fit per place. `exclude`
 * leaves places out (e.g. ones already shown); `radius` (metres) starts the search smaller.
 */
export const placesSchema = locationSchema
  .extend({
    items: z.array(placeItemSchema).max(30).optional(),
    members: z.array(placeMemberSchema).min(1).max(5).optional(),
    exclude: z.array(idSchema).max(30).optional(),
    radius: z.number().int().min(500).max(10_000).optional(),
  })
  .refine((b) => (b.items?.length ?? 0) > 0 || b.members?.some((m) => m.profile.items.length), "Add at least one pick");

// ================================================================ final build (0D, additive)
// Request bodies for the new routes (final-build-plan section 4). Frozen after Stage 0: a missing
// field is added additively by the lead between stages.

/** RequestSignals: mood, age range and Hidden Gems, sent only with the person's own requests. */
export const signalsSchema = z.object({
  mood: z.enum(MOODS).optional(),
  ageBucket: z.enum(AGE_BUCKETS).optional(),
  hiddenGems: z.boolean().optional(),
});

/** The optional `signals` field every existing AI route body gains (1C reads it). */
const withSignals = {
  signals: signalsSchema.optional(),
  /** Place ids shown on this device lately (newest first), so Larry picks fresh places first. */
  recentPlaces: z.array(idSchema).max(30).optional(),
};
export const chatSignalsSchema = chatSchema.extend(withSignals);
export const larrySignalsSchema = larrySchema.extend(withSignals);
export const commonGroundSignalsSchema = commonGroundSchema.extend(withSignals);
export const placesSignalsSchema = locationSchema
  .extend({
    items: z.array(placeItemSchema).max(30).optional(),
    members: z.array(placeMemberSchema).min(1).max(5).optional(),
    exclude: z.array(idSchema).max(30).optional(),
    radius: z.number().int().min(500).max(10_000).optional(),
    ...withSignals,
  })
  .refine((b) => (b.items?.length ?? 0) > 0 || b.members?.some((m) => m.profile.items.length), "Add at least one pick");

/** Every Plan Ticket worry, including the two new ones ("loud" is STRETCH). */
export const obstacleSchema = z.enum(["nervous", "words", "alone", "travel", "loud", "leave"]);

/** An opener or if-then line: one cleaned line of text. */
export const lineSchema = (max = 200) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => cleanLine(s, max));

/** POST /api/suggest additions (1A): signals, and the worry and opener the ticket already has. */
export const suggestSignalsSchema = suggestSchema.extend({
  ...withSignals,
  obstacle: obstacleSchema.optional(),
  opener: lineSchema().optional(),
});
export const nextRungSignalsSchema = nextRungSchema.extend(withSignals);
export const planBSignalsSchema = planBSchema.extend(withSignals);

// ---------------------------------------------------------------- check-ins

const latSchema = z.number().min(-90).max(90);
const lonSchema = z.number().min(-180).max(180);
/** Phone accuracy in metres. Anything worse than 5 km can't show presence. */
const accuracySchema = z.number().min(0).max(5000);
/** A podium key: the secret HMAC from alias.ts (64 hex). Never logged. */
export const podiumKeySchema = z.string().regex(PODIUM_HEX_RE);
/** Server-signed visit token (base64url parts joined by dots). */
const visitTokenSchema = z.string().regex(/^[\w.-]{16,600}$/);

/**
 * POST /api/checkins/arrive (ArriveRequest). No client flag can skip a check: unknown fields (an old
 * `demo: true`, say) are dropped. Only the server decides the demo/testing account (Session.isDemo, D19).
 */
export const arriveSchema = z.object({
  placeId: idSchema,
  lat: latSchema,
  lon: lonSchema,
  accuracyM: accuracySchema,
  /** This phone's random id (meet/client deviceId). Only a device-only visit uses it, HMACed, for its one-per-day key. */
  deviceId: z.string().regex(/^[\w-]{8,100}$/).optional(),
});

/** POST /api/checkins/leave (LeaveRequest) */
export const leaveSchema = z.object({
  visitToken: visitTokenSchema,
  lat: latSchema,
  lon: lonSchema,
  accuracyM: accuracySchema,
  podiumKey: podiumKeySchema.optional(),
  saidHi: z.boolean().optional(),
  ticketId: idSchema.optional(),
});

const stageSchema = z.enum(STAGES);

/** SyncedPlaceCounter: folded counts only (D11). Extra fields such as weeksBits are dropped. */
export const syncedPlaceCounterSchema = z.object({
  placeId: idSchema,
  placeName: itemNameSchema,
  visits: z.number().int().min(0).max(100_000),
  stage: stageSchema.nullable(),
  spotWeeks: z.number().int().min(0).max(10_000),
});

// ---------------------------------------------------------------- accounts

/** Account username: only names the generator makes ("QuietOtter42"), so no real names. */
export const usernameSchema = z.string().max(40).refine(isGeneratedName, "Pick a name from the generator");

/** POST /api/account (SignupRequest). The 18+ check itself is the route's (ageOn). */
export const signupSchema = z.object({
  name: z
    .string()
    .max(200)
    .transform((n) => cleanName(n))
    .refine((n) => n.length > 0, "Add your name"),
  username: usernameSchema,
  dob: z.object({
    d: z.number().int().min(1).max(31),
    m: z.number().int().min(1).max(12),
    y: z.number().int().min(1900).max(2100),
  }),
});

/** PATCH /api/account (AccountSettingsRequest): the account's own switches; at least one. */
export const accountSettingsSchema = z
  .strictObject({ showOnLeaderboards: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

/** A First Step or plan step as stored on the device; unknown plan fields pass through, bounded below. */
const syncStepSchema = z
  .looseObject({
    id: z.string().max(64),
    kind: z.enum(["go", "say", "show"]),
    text: z.string().max(400),
    createdAt: z.number().int().min(0),
    done: z.boolean(),
  })
  // The server keeps no times of real-world actions ("We keep counts, not a diary").
  .transform((step) => {
    const rest: Record<string, unknown> = { ...step };
    delete rest.doneAt;
    delete rest.checkedAt;
    return rest as typeof step;
  });

/** The largest sync blob accepted, as JSON. */
export const SYNC_MAX_BYTES = 300_000;

/** PUT /api/account/sync (SyncBlob) */
export const syncBlobSchema = z
  .object({
    persona: personaSchema.nullable(),
    steps: z.array(syncStepSchema).max(300),
    placeCounters: z.array(syncedPlaceCounterSchema).max(500),
    ageBucket: z.enum(AGE_BUCKETS).optional(),
    publicTitleCounts: z.partialRecord(z.enum(PUBLIC_TITLES), z.number().int().min(0).max(10_000)).optional(),
  })
  .refine((b) => JSON.stringify(b).length <= SYNC_MAX_BYTES, "Too much to sync at once");

// ---------------------------------------------------------------- podium and friends

/** POST /api/podium/[placeId] (PodiumRerollRequest) */
export const podiumRerollSchema = z.object({ oldKey: podiumKeySchema, newKey: podiumKeySchema }).refine((b) => b.oldKey !== b.newKey, "Same key");

/** DELETE /api/podium/mine (PodiumMineRequest) */
export const podiumMineSchema = z.object({
  keys: z.array(z.object({ placeId: idSchema, key: podiumKeySchema })).max(1000),
});

/** A Firebase uid. */
export const uidSchema = z.string().regex(/^[\w:-]{1,128}$/);
/** A friend invite code: 128 bits as base64url (22 characters). */
export const inviteCodeSchema = z.string().regex(/^[\w-]{22}$/);

/** POST /api/friends */
export const friendsPostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("accept"), code: inviteCodeSchema }),
]);
/** PUT /api/friends */
export const friendsPutSchema = z.object({ sharing: z.boolean() });
/** DELETE /api/friends (also on block) */
export const friendsDeleteSchema = z.object({ uid: uidSchema });

// ---------------------------------------------------------------- Qloo extras

/** POST /api/fingerprint */
export const fingerprintSchema = z.object({ card: profileSchema });

/** GET /api/rising?city= */
export const risingQuerySchema = z.object({
  city: z
    .string()
    .max(80)
    .transform((c) => cleanName(c))
    .refine((c) => c.length > 0, "Add a city"),
});

/** GET /api/matchday?entities=<id>,<id> (Qloo entity ids, at most 10) */
export const matchdayQuerySchema = z.object({
  entities: z
    .string()
    .max(700)
    .transform((s) => [...new Set(s.split(",").map((e) => e.trim()).filter(Boolean))])
    .pipe(z.array(idSchema).min(1).max(10)),
});
