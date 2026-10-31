// The repository interface (D18; final-build-plan section 2, rule 5). All people, podium, friends,
// account and group code goes through a Repo, so no unit or e2e test touches real Firestore.
// Implementations: memory.ts (0D, LARRY_DB=memory) and firestore.ts (1F). Picked by getRepo() in
// ./index.ts. Every method returns copies: changing a returned object never changes the store.
import type { Account, DateOfBirth, SyncBlob } from "../types/account";
import type { VenueRef } from "../types/profile";
import type { PublicTitle } from "../types/titles";
import type { GroupGround, PlanTicket } from "../contracts";
import type { Place, Profile } from "../types";
import type { Mood } from "../types/signals";

/* ---------------------------------------------------------------- key-value with TTL */

/**
 * JSON documents with an optional time to live. Same shape as MeetKv (src/lib/meet/kv.ts), so a
 * Firestore-backed Repo can serve Open to meet in production (Stage 2 switches getMeetKv to it,
 * since there is no Upstash). Also used for check-in day keys (26 h TTL) and co-presence keys.
 */
export interface RepoKv {
  get<T>(key: string): Promise<T | null>;
  /**
   * Read-modify-write. `change` gets a copy (or null when there is none) and returns the new
   * value, or null to leave it alone; `undefined` deletes it. It may run more than once on a
   * concurrent write, so keep it pure. ttlMs: how long the written value lives (none = forever).
   */
  update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number): Promise<T | null>;
  del(key: string): Promise<void>;
}

/* ---------------------------------------------------------------- accounts */

/** What the database keeps for an account: the public Account plus the date of birth (never returned by an API). */
export interface StoredAccount extends Account {
  dob: DateOfBirth;
  /**
   * A made-up demo friend for the demo account (src/lib/groups/demo.ts): no phone, no sign-in
   * record, never a real person. Set only by the seeding code, never by a request.
   */
  isDemoFriend?: true;
}

export interface AccountsRepo {
  get(uid: string): Promise<StoredAccount | null>;
  /** False when an account with this uid already exists (nothing is written). */
  create(account: StoredAccount): Promise<boolean>;
  /**
   * Atomic read-modify-write (budget charges, Glory). `change` may run more than once, so keep it
   * pure; the uid can't change. Null when there is no such account.
   */
  update(uid: string, change: (cur: StoredAccount) => StoredAccount): Promise<StoredAccount | null>;
  delete(uid: string): Promise<void>;
}

/** Usernames are unique case-insensitively ("QuietOtter42" and "quietotter42" are the same). */
export interface UsernamesRepo {
  /** True when the name is now this uid's (free, or already theirs); false when someone else has it. */
  claim(username: string, uid: string): Promise<boolean>;
  owner(username: string): Promise<string | null>;
  /** Frees the name only if this uid holds it. */
  release(username: string, uid: string): Promise<void>;
}

export interface SyncRepo {
  get(uid: string): Promise<SyncBlob | null>;
  put(uid: string, blob: SyncBlob): Promise<void>;
  delete(uid: string): Promise<void>;
}

/** The friend-visible side of a profile: which venue each public title is at. Synced at most once a day. */
export interface ProfileRecord {
  publicTitles: { title: PublicTitle; venue: VenueRef }[];
}

export interface ProfilesRepo {
  get(uid: string): Promise<ProfileRecord | null>;
  put(uid: string, record: ProfileRecord): Promise<void>;
  delete(uid: string): Promise<void>;
}

/* ---------------------------------------------------------------- podium */

/** One podium row: sha256(podiumKey) and its verified visits. The owner's uid is never stored. */
export interface PodiumRow {
  podiumId: string;
  visits: number;
}

/**
 * The one set of real podiums. There is no demo podium (D19): the demo/testing account's visits
 * land here like anyone's, and only when its own "Show me on place leaderboards" switch is on.
 */
export interface PodiumRepo {
  /** Adds verified visits to a podium id at a place (creating it). Returns the new total. */
  add(placeId: string, podiumId: string, by?: number): Promise<number>;
  /** Moves a count to a new id (re-roll); merges into the new id if it exists. False when `from` has no count. */
  move(placeId: string, from: string, to: string): Promise<boolean>;
  remove(entries: { placeId: string; podiumId: string }[]): Promise<void>;
  /** Most visits first; ties by podiumId, so the order is stable. */
  top(placeId: string, n: number): Promise<PodiumRow[]>;
  participants(placeId: string): Promise<number>;
}

/* ---------------------------------------------------------------- friends */

export interface FriendLink {
  uid: string;
  /** Duo count (D15, STRETCH): a count only, never dates. */
  timesMet: number;
}

export interface FriendsRepo {
  list(uid: string): Promise<FriendLink[]>;
  are(a: string, b: string): Promise<boolean>;
  /** Mutual: one call links both ways. Linking someone to themselves does nothing. */
  add(a: string, b: string): Promise<void>;
  remove(a: string, b: string): Promise<void>;
  /** Every link of this uid (account deletion). */
  removeAll(uid: string): Promise<void>;
  /** D15 STRETCH. Returns the new count (0 when they are not friends). */
  bumpTimesMet(a: string, b: string): Promise<number>;
}

/** A pending invite. Only sha256(code) is stored, so a database read can't accept an invite. */
export interface StoredInvite {
  codeHash: string;
  uid: string;
  /** ms */
  expiresAt: number;
}

export interface InvitesRepo {
  create(invite: StoredInvite): Promise<void>;
  /** Single use: returns and deletes the invite; null when there is none or it has expired. */
  take(codeHash: string, now: number): Promise<StoredInvite | null>;
  deleteByUid(uid: string): Promise<void>;
}

/* ---------------------------------------------------------------- groups (D25, D26) */

/** A group member as stored. `id` is per group (random); the uid never leaves the server. */
export interface StoredGroupMember {
  id: string;
  uid: string;
  name: string;
  username: string;
  /** Their taste card as it was when they joined (Larry's common ground reads it). */
  profile: Profile;
  color: string;
  joinedAt: number;
  /** Their own mood (blended in counts only) and Hidden Gems switch. Never age. */
  mood?: Mood;
  hiddenGems?: boolean;
  /** A made-up demo friend (copied from the account): labelled "Demo friend" wherever they show. */
  isDemoFriend?: true;
}

export interface StoredGroup {
  id: string;
  createdAt: number;
  /** The creator's uid: may remove members, close joining and show a fresh QR. */
  creator: string;
  /** People including the creator, 2 to 5. */
  size: 2 | 3 | 4 | 5;
  members: StoredGroupMember[];
  /** Same uids as members, for the "my groups" query. */
  memberUids: string[];
  /** ms; 0 = joining closed. */
  joinOpenUntil: number;
  /** Part of every join token; changing it (close, remove, a fresh QR) cancels every earlier QR. */
  joinNonce: string;
  /** Members who left or were removed, by member id: old lines keep a name, and Block/Report still work. */
  departed: Record<string, { name: string; uid: string }>;
  /** Bumped on every change, including each message, so phones poll with ?since=version. */
  version: number;
  lastAt: number;
  /** When Larry's opening was posted; `openingSince` while one is being written (a lock). */
  openedAt?: number;
  openingSince?: number;
  /** One Larry reply at a time. */
  larryLock?: { id: string; since: number };
  larryAway?: boolean;
  /** Larry reads only messages after this (it came back with /hello). */
  larryBackAt?: number;
  ground?: GroupGround;
  groundKey?: string;
  planTicket?: PlanTicket;
  /** Safety step-ins, by flag, for a cooldown. */
  flagsAt?: Record<string, number>;
}

export interface StoredGroupMessage {
  id: string;
  /** A member id, "larry" or "system". */
  from: string;
  text: string;
  at: number;
  kind: "opening" | "larry" | "care" | "system" | "person";
  /** True when the line was for Larry (@Larry or a /command). */
  toLarry?: boolean;
  /** Sent while Larry was excused: never read by Larry. */
  excused?: boolean;
  cmd?: string;
  ground?: GroupGround;
  planTicket?: PlanTicket;
  places?: Place[];
}

export interface GroupsRepo {
  get(id: string): Promise<StoredGroup | null>;
  /** False when the id is taken. */
  create(group: StoredGroup): Promise<boolean>;
  /**
   * Atomic read-modify-write. `change` gets a copy and returns the new group, or null to leave it
   * alone (the current group is returned). It may run more than once, so keep it pure; it may throw
   * to refuse. Null when there is no such group.
   */
  update(id: string, change: (cur: StoredGroup) => StoredGroup | null): Promise<StoredGroup | null>;
  /** Deletes the group and all its messages. */
  delete(id: string): Promise<void>;
  /** Every group this uid is a member of. */
  listFor(uid: string): Promise<StoredGroup[]>;
}

export interface GroupMessagesRepo {
  add(groupId: string, message: StoredGroupMessage): Promise<void>;
  /** The newest `limit` messages at or after `sinceAt`, oldest first. */
  list(groupId: string, opts: { sinceAt: number; limit: number }): Promise<StoredGroupMessage[]>;
  /** Deletes messages older than `beforeAt` (30-day retention). */
  prune(groupId: string, beforeAt: number): Promise<void>;
}

/** Blocks between accounts: permanent, both ways for visibility, never revealed to the blocked person. */
export interface BlocksRepo {
  add(blocker: string, blocked: string): Promise<void>;
  /** True when either has blocked the other. */
  between(a: string, b: string): Promise<boolean>;
  /** Everyone this uid has blocked, and everyone who blocked them. */
  involving(uid: string): Promise<string[]>;
  /** Account deletion. */
  removeAll(uid: string): Promise<void>;
}

/* ---------------------------------------------------------------- the repo */

export interface Repo {
  kind: "memory" | "firestore";
  accounts: AccountsRepo;
  usernames: UsernamesRepo;
  sync: SyncRepo;
  profiles: ProfilesRepo;
  podium: PodiumRepo;
  friends: FriendsRepo;
  invites: InvitesRepo;
  groups: GroupsRepo;
  groupMessages: GroupMessagesRepo;
  blocks: BlocksRepo;
  kv: RepoKv;
}

/** Case-insensitive username key. */
export const usernameKey = (username: string) => username.trim().toLowerCase();
