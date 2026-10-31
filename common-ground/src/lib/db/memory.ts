import "server-only";
import {
  type FriendLink,
  type ProfileRecord,
  type Repo,
  type RepoKv,
  type StoredAccount,
  type StoredGroup,
  type StoredGroupMessage,
  type StoredInvite,
  usernameKey,
} from "./types";
import type { SyncBlob } from "../types/account";

// The in-memory Repo (LARRY_DB=memory): Vitest, Playwright and local development. One process only:
// it is gone after a restart. The shared store
// sits on globalThis so it survives hot reloads in `next dev`.

interface KvEntry {
  json: string;
  expiresAt: number;
}

interface Store {
  accounts: Map<string, StoredAccount>;
  usernames: Map<string, string>;
  sync: Map<string, SyncBlob>;
  profiles: Map<string, ProfileRecord>;
  /** placeId -> podiumId -> visits */
  podium: Map<string, Map<string, number>>;
  /** uid -> friend uid -> link */
  friends: Map<string, Map<string, FriendLink>>;
  invites: Map<string, StoredInvite>;
  groups: Map<string, StoredGroup>;
  /** groupId -> messages, oldest first */
  groupMessages: Map<string, StoredGroupMessage[]>;
  /** blocker uid -> blocked uids */
  blocks: Map<string, Set<string>>;
  kv: Map<string, KvEntry>;
}

const newStore = (): Store => ({
  accounts: new Map(),
  usernames: new Map(),
  sync: new Map(),
  profiles: new Map(),
  podium: new Map(),
  friends: new Map(),
  invites: new Map(),
  groups: new Map(),
  groupMessages: new Map(),
  blocks: new Map(),
  kv: new Map(),
});

const copy = <T>(v: T): T => structuredClone(v);

function memoryKv(s: Store): RepoKv {
  const read = <T>(key: string, now: number): T | null => {
    const e = s.kv.get(key);
    if (!e) return null;
    if (e.expiresAt <= now) {
      s.kv.delete(key);
      return null;
    }
    return JSON.parse(e.json) as T;
  };
  return {
    async get<T>(key: string) {
      return read<T>(key, Date.now());
    },
    async update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number) {
      const now = Date.now();
      const cur = read<T>(key, now);
      const next = change(cur === null ? null : copy(cur));
      if (next === null) return cur;
      if (next === undefined) {
        s.kv.delete(key);
        return null;
      }
      s.kv.set(key, { json: JSON.stringify(next), expiresAt: ttlMs === undefined ? Infinity : now + ttlMs });
      return copy(next);
    },
    async del(key) {
      s.kv.delete(key);
    },
  };
}

/** A fresh, empty in-memory Repo (tests that want isolation). */
export function createMemoryRepo(): Repo {
  return repoOver(newStore());
}

function repoOver(s: Store): Repo {
  const board = (placeId: string) => {
    let b = s.podium.get(placeId);
    if (!b) s.podium.set(placeId, (b = new Map()));
    return b;
  };
  const links = (uid: string) => {
    let m = s.friends.get(uid);
    if (!m) s.friends.set(uid, (m = new Map()));
    return m;
  };

  return {
    kind: "memory",

    accounts: {
      async get(uid) {
        const a = s.accounts.get(uid);
        return a ? copy(a) : null;
      },
      async create(account) {
        if (s.accounts.has(account.uid)) return false;
        s.accounts.set(account.uid, copy(account));
        return true;
      },
      async update(uid, change) {
        const cur = s.accounts.get(uid);
        if (!cur) return null;
        const next = { ...change(copy(cur)), uid };
        s.accounts.set(uid, copy(next));
        return copy(next);
      },
      async delete(uid) {
        s.accounts.delete(uid);
      },
    },

    usernames: {
      async claim(username, uid) {
        const k = usernameKey(username);
        const owner = s.usernames.get(k);
        if (owner && owner !== uid) return false;
        s.usernames.set(k, uid);
        return true;
      },
      async owner(username) {
        return s.usernames.get(usernameKey(username)) ?? null;
      },
      async release(username, uid) {
        const k = usernameKey(username);
        if (s.usernames.get(k) === uid) s.usernames.delete(k);
      },
    },

    sync: {
      async get(uid) {
        const b = s.sync.get(uid);
        return b ? copy(b) : null;
      },
      async put(uid, blob) {
        s.sync.set(uid, copy(blob));
      },
      async delete(uid) {
        s.sync.delete(uid);
      },
    },

    profiles: {
      async get(uid) {
        const p = s.profiles.get(uid);
        return p ? copy(p) : null;
      },
      async put(uid, record) {
        s.profiles.set(uid, copy(record));
      },
      async delete(uid) {
        s.profiles.delete(uid);
      },
    },

    podium: {
      async add(placeId, podiumId, by = 1) {
        const b = board(placeId);
        const n = (b.get(podiumId) ?? 0) + Math.max(0, by);
        b.set(podiumId, n);
        return n;
      },
      async move(placeId, from, to) {
        const b = board(placeId);
        const n = b.get(from);
        if (n === undefined) return false;
        if (from === to) return true;
        b.delete(from);
        b.set(to, (b.get(to) ?? 0) + n);
        return true;
      },
      async remove(entries) {
        for (const { placeId, podiumId } of entries) board(placeId).delete(podiumId);
      },
      async top(placeId, n) {
        return [...board(placeId)]
          .map(([podiumId, visits]) => ({ podiumId, visits }))
          .sort((x, y) => y.visits - x.visits || (x.podiumId < y.podiumId ? -1 : x.podiumId > y.podiumId ? 1 : 0))
          .slice(0, Math.max(0, n));
      },
      async participants(placeId) {
        return board(placeId).size;
      },
    },

    friends: {
      async list(uid) {
        return [...(s.friends.get(uid)?.values() ?? [])].map(copy);
      },
      async are(a, b) {
        return !!s.friends.get(a)?.has(b);
      },
      async add(a, b) {
        if (a === b) return;
        const timesMet = s.friends.get(a)?.get(b)?.timesMet ?? 0;
        links(a).set(b, { uid: b, timesMet });
        links(b).set(a, { uid: a, timesMet });
      },
      async remove(a, b) {
        s.friends.get(a)?.delete(b);
        s.friends.get(b)?.delete(a);
      },
      async removeAll(uid) {
        for (const other of s.friends.get(uid)?.keys() ?? []) s.friends.get(other)?.delete(uid);
        s.friends.delete(uid);
      },
      async bumpTimesMet(a, b) {
        const ab = s.friends.get(a)?.get(b);
        const ba = s.friends.get(b)?.get(a);
        if (!ab || !ba) return 0;
        ab.timesMet += 1;
        ba.timesMet = ab.timesMet;
        return ab.timesMet;
      },
    },

    invites: {
      async create(invite) {
        s.invites.set(invite.codeHash, copy(invite));
      },
      async take(codeHash, now) {
        const inv = s.invites.get(codeHash);
        if (!inv) return null;
        s.invites.delete(codeHash);
        return inv.expiresAt > now ? copy(inv) : null;
      },
      async deleteByUid(uid) {
        for (const [k, inv] of s.invites) if (inv.uid === uid) s.invites.delete(k);
      },
    },

    groups: {
      async get(id) {
        const x = s.groups.get(id);
        return x ? copy(x) : null;
      },
      async create(group) {
        if (s.groups.has(group.id)) return false;
        s.groups.set(group.id, copy(group));
        return true;
      },
      async update(id, change) {
        const cur = s.groups.get(id);
        if (!cur) return null;
        const next = change(copy(cur));
        if (next === null) return copy(cur);
        s.groups.set(id, copy({ ...next, id }));
        return copy({ ...next, id });
      },
      async delete(id) {
        s.groups.delete(id);
        s.groupMessages.delete(id);
      },
      async listFor(uid) {
        return [...s.groups.values()].filter((x) => x.memberUids.includes(uid)).map(copy);
      },
    },

    groupMessages: {
      async add(groupId, message) {
        const list = s.groupMessages.get(groupId) ?? [];
        list.push(copy(message));
        list.sort((a, b) => a.at - b.at);
        s.groupMessages.set(groupId, list);
      },
      async list(groupId, { sinceAt, limit }) {
        const list = (s.groupMessages.get(groupId) ?? []).filter((m) => m.at >= sinceAt);
        return list.slice(-Math.max(0, limit)).map(copy);
      },
      async prune(groupId, beforeAt) {
        const list = s.groupMessages.get(groupId);
        if (list) s.groupMessages.set(groupId, list.filter((m) => m.at >= beforeAt));
      },
    },

    blocks: {
      async add(blocker, blocked) {
        if (blocker === blocked) return;
        let set = s.blocks.get(blocker);
        if (!set) s.blocks.set(blocker, (set = new Set()));
        set.add(blocked);
      },
      async between(a, b) {
        return !!s.blocks.get(a)?.has(b) || !!s.blocks.get(b)?.has(a);
      },
      async involving(uid) {
        const out = new Set(s.blocks.get(uid) ?? []);
        for (const [blocker, set] of s.blocks) if (set.has(uid)) out.add(blocker);
        return [...out];
      },
      async removeAll(uid) {
        s.blocks.delete(uid);
        for (const set of s.blocks.values()) set.delete(uid);
      },
    },

    kv: memoryKv(s),
  };
}

const g = globalThis as typeof globalThis & { __larryMemoryRepo?: { store: Store; repo: Repo } };

/** The shared in-memory Repo for this process. */
export function memoryRepo(): Repo {
  if (!g.__larryMemoryRepo) {
    const store = newStore();
    g.__larryMemoryRepo = { store, repo: repoOver(store) };
  }
  return g.__larryMemoryRepo.repo;
}

/** Empties the shared in-memory Repo. For tests. */
export function resetMemoryRepo() {
  const r = memoryRepo();
  Object.assign(g.__larryMemoryRepo!.store, newStore());
  return r;
}
