// Every localStorage key the app uses, in one place. New code imports from here; existing modules
// move their literal keys here in their own stages (the values must not change, or devices lose data).

export const STORAGE_KEYS = {
  /* ---------- existing (values fixed: devices already hold them) ---------- */
  /** Larry's persona (src/lib/persona.ts). Synced for accounts. */
  persona: "larry.persona",
  /** Legacy taste card kept beside the persona. */
  legacyProfile: "cg.profile",
  /** First Steps and plans (src/lib/storage.ts). Synced for accounts. */
  steps: "cg.steps",
  /** Check-in list v1 (src/lib/checkins.ts). Replaced by placeCounters in Check-in v2. */
  checkinsV1: "larry.checkins",
  /** Access code (src/lib/api-client.ts). Goes away when the budget moves to accounts. */
  accessCode: "larry.accessCode",
  /** Open to meet device id (src/lib/meet/client.ts). Never synced. */
  meetDevice: "larry.device",
  /** One-time "Just us" note shown. */
  justUsNote: "larry.note.just-us",
  /** Prefix: room credentials, one key per room code ("larry.room.ABC234"). Never synced. */
  roomPrefix: "larry.room.",

  /* ---------- new in the final build ---------- */
  /**
   * 32 random bytes (base64url): the HMAC key behind every podium key (src/lib/alias.ts).
   * NEVER synced, never sent: only the derived per-place podium keys leave the device.
   */
  deviceSecret: "larry.deviceSecret",
  /** Re-roll count per place: Record<placeId, number>. Never synced (it would link places). */
  podiumRerolls: "larry.podium.rerolls",
  /** "Show me on place leaderboards" on the device (D12: off by default; accounts mirror Account.showOnLeaderboards). */
  podiumOptIn: "larry.podium.optIn",
  /** Mood, age range and Hidden Gems (RequestSignals). Age syncs as SyncBlob.ageBucket; mood never syncs. */
  mood: "larry.mood",
  ageBucket: "larry.ageBucket",
  hiddenGems: "larry.hiddenGems",
  /** Check-in v2 counters: PlaceCounter[]. Only SyncedPlaceCounter fields ever sync. */
  placeCounters: "larry.places",
  /** The open visit: { placeId, placeName, visitToken, dwellMs } between arrive and leave. Never synced. */
  openVisit: "larry.visit",
  /** Glory for device-only users (accounts keep Glory on the server). */
  deviceGlory: "larry.glory",
  /** ISO week of the last guess, so a guess is asked at most once a week. Never synced. */
  guessWeek: "larry.guessWeek",
  /** Quest[] for this month. */
  quests: "larry.quests",
  /** Next-move back-off: MoveKind[] skipped, most recent last. */
  ignoredMoves: "larry.moves.ignored",
  /** True once the Taste Fingerprint was seen. */
  fingerprintSeen: "larry.fingerprint.seen",
  /** Time of the last account sync (ms), for the once-a-day debounce. */
  lastSync: "larry.sync.last",
  /** Mic language for speech-to-text ("en-IN" or "hi-IN"). Device-only. */
  speechLang: "larry.speechLang",
  /** "1" while this device is signed in, so pages know to load the Firebase SDK. Holds no token or number. */
  authSignedIn: "larry.auth.signedIn",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Keys that must never leave the device, by sync or by any request body. */
export const NEVER_SYNCED: readonly StorageKey[] = [
  STORAGE_KEYS.deviceSecret,
  STORAGE_KEYS.podiumRerolls,
  STORAGE_KEYS.meetDevice,
  STORAGE_KEYS.roomPrefix,
  STORAGE_KEYS.openVisit,
  STORAGE_KEYS.guessWeek,
  STORAGE_KEYS.mood,
  STORAGE_KEYS.speechLang,
  STORAGE_KEYS.authSignedIn,
];
