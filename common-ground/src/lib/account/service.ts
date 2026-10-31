import "server-only";
import { getRepo } from "../db";
import type { Repo, StoredAccount } from "../db/types";
import { CODE_BUDGET_CENTS } from "../contracts";
import { forgetGroupsOf } from "../groups/service";
import {
  ACCOUNT_MIN_AGE,
  type Account,
  type AccountSettingsRequest,
  ageOn,
  DEFAULT_SHOW_ON_LEADERBOARDS,
  type SignupRequest,
  type SyncBlob,
} from "../types/account";
import type { AgeBucket } from "../types/signals";

// Account rules, kept apart from the routes so they can be tested without HTTP. Every read and
// write goes through the Repo (memory in tests, Firestore in production).

/** Each account's Larry time: 25 cents of AI use (queue: replaces access codes). */
export const ACCOUNT_BUDGET_CENTS = CODE_BUDGET_CENTS;

/** What an API may return: the stored account without the date of birth. Never the phone number. */
export function publicAccount(a: StoredAccount): Account {
  return {
    uid: a.uid,
    name: a.name,
    username: a.username,
    createdAt: a.createdAt,
    budgetCentsLeft: Math.max(0, Math.round(a.budgetCentsLeft * 100) / 100),
    glory: a.glory,
    sharingWithFriends: a.sharingWithFriends,
    showOnLeaderboards: a.showOnLeaderboards,
    publicTitleCounts: a.publicTitleCounts ?? {},
    ...ageField(a),
  };
}

function ageField(a: StoredAccount): { ageBucket?: AgeBucket } {
  const age = a.dob ? ageOn(a.dob, new Date()) : null;
  return age === null ? {} : { ageBucket: adultBucket(age) };
}

/** The range for an 18+ account's age (accounts are adults, so never "13-17"). */
function adultBucket(age: number): AgeBucket {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  return "45+";
}

export type SignupResult =
  | { ok: true; account: Account; created: boolean }
  | { ok: false; status: 403 | 409; reason: "under-18" | "username-taken" | "bad-date"; error: string };

/** Warm, plain answers for the sign-up screens. */
export const SIGNUP_TEXT = {
  under18:
    "Accounts are for people 18 and over. You can keep using Larry on this phone without one: your card, places and plans all still work.",
  taken: "Someone just took that name. Here is a fresh one.",
  badDate: "That date doesn't look right. Pick your day, month and year again.",
} as const;

/**
 * Makes the account for a verified uid. The 18+ check runs here, on the server; nothing is stored
 * for someone under 18. Signing up twice returns the existing account unchanged.
 */
export async function signup(uid: string, req: SignupRequest, now = new Date(), repo: Repo = getRepo()): Promise<SignupResult> {
  const existing = await repo.accounts.get(uid);
  if (existing) return { ok: true, account: publicAccount(existing), created: false };
  const age = ageOn(req.dob, now);
  if (age === null) return { ok: false, status: 403, reason: "bad-date", error: SIGNUP_TEXT.badDate };
  if (age < ACCOUNT_MIN_AGE) return { ok: false, status: 403, reason: "under-18", error: SIGNUP_TEXT.under18 };
  if (!(await repo.usernames.claim(req.username, uid))) {
    return { ok: false, status: 409, reason: "username-taken", error: SIGNUP_TEXT.taken };
  }
  const account: StoredAccount = {
    uid,
    name: req.name,
    username: req.username,
    createdAt: now.getTime(),
    budgetCentsLeft: ACCOUNT_BUDGET_CENTS,
    glory: 0,
    sharingWithFriends: false,
    showOnLeaderboards: DEFAULT_SHOW_ON_LEADERBOARDS,
    publicTitleCounts: {},
    dob: req.dob,
  };
  if (!(await repo.accounts.create(account))) {
    // Lost a race with a second sign-up tap: the first one won.
    const won = await repo.accounts.get(uid);
    if (won) return { ok: true, account: publicAccount(won), created: false };
  }
  return { ok: true, account: publicAccount(account), created: true };
}

/** PATCH /api/account: the account's own switches. Null when there is no account. */
export async function updateSettings(uid: string, change: AccountSettingsRequest, repo: Repo = getRepo()): Promise<Account | null> {
  const next = await repo.accounts.update(uid, (a) => ({
    ...a,
    ...(typeof change.showOnLeaderboards === "boolean" ? { showOnLeaderboards: change.showOnLeaderboards } : {}),
  }));
  return next ? publicAccount(next) : null;
}

/**
 * Takes `cents` of Larry time from the account in one atomic step. Never goes below 0, and a
 * negative or broken amount changes nothing. Returns what is left, or null with no account.
 */
export async function chargeAccount(uid: string, cents: number, repo: Repo = getRepo()): Promise<number | null> {
  const take = Number.isFinite(cents) && cents > 0 ? cents : 0;
  const next = await repo.accounts.update(uid, (a) => ({ ...a, budgetCentsLeft: Math.max(0, a.budgetCentsLeft - take) }));
  return next ? next.budgetCentsLeft : null;
}

/** Sync PUT: keeps the blob and copies the device's public title counts onto the account. */
export async function putSync(uid: string, blob: SyncBlob, repo: Repo = getRepo()): Promise<boolean> {
  const exists = await repo.accounts.get(uid);
  if (!exists) return false;
  await repo.sync.put(uid, blob);
  if (blob.publicTitleCounts) {
    const counts = blob.publicTitleCounts;
    await repo.accounts.update(uid, (a) => ({ ...a, publicTitleCounts: counts }));
  }
  return true;
}

/**
 * Deletes everything the server keeps for this account: the account, its username, synced data,
 * profile, friend links, pending invites, and every group seat (the last one out
 * deletes the group) with its blocks. Podium entries are removed by the device
 * first (DELETE /api/podium/mine), because only the device knows its podium keys. The Firebase
 * auth user is removed by the route.
 */
export async function deleteAccountData(uid: string, repo: Repo = getRepo()): Promise<void> {
  const a = await repo.accounts.get(uid);
  // Groups first, while the username still belongs to this account: no seat is left behind.
  await forgetGroupsOf(uid, repo);
  await Promise.all([
    a ? repo.usernames.release(a.username, uid) : Promise.resolve(),
    repo.sync.delete(uid),
    repo.profiles.delete(uid),
    repo.friends.removeAll(uid),
    repo.invites.deleteByUid(uid),
  ]);
  await repo.accounts.delete(uid);
}
