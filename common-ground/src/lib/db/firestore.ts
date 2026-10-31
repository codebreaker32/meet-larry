import "server-only";
import { createHash } from "node:crypto";
import { type Firestore, type Query, Timestamp } from "firebase-admin/firestore";
import { adminFirestore } from "../firebase/admin";
import type { SyncBlob } from "../types/account";
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

// The Firestore Repo (LARRY_DB=firestore), in the project named by GOOGLE_CLOUD_PROJECT, database
// (default). Server only, through firebase-admin; the security rules deny every client read and
// write. Same behaviour as memory.ts (the shared contract in types.ts). Layout:
//   accounts/{uid}                       StoredAccount (dob kept, never returned by an API)
//   usernames/{lower-case name}          { uid }
//   sync/{uid}                           SyncBlob (folded counts only, D11)
//   profiles/{uid}                       ProfileRecord
//   podium/{placeId}/entries/{podiumId}  { visits }   (podiumId = sha256(podium key); no uid)
//   friends/{uid}/links/{otherUid}       FriendLink
//   invites/{codeHash}                   StoredInvite
//   groups/{id}                          StoredGroup (memberUids for the "my groups" query)
//   groups/{id}/messages/{msgId}         StoredGroupMessage + expireAt (Timestamp, 30 days, for a TTL policy)
//   blocks/{blocker}_{blocked}           { blocker, blocked }
//   kv/{sha256(key)}                     { json, expiresAt (ms), expireAt (Timestamp, for a TTL policy) }
// Expired kv documents are ignored on read; a Firestore TTL policy on kv.expireAt deletes them.

const C = {
  accounts: "accounts",
  usernames: "usernames",
  sync: "sync",
  profiles: "profiles",
  podium: "podium",
  friends: "friends",
  invites: "invites",
  groups: "groups",
  blocks: "blocks",
  kv: "kv",
} as const;

/** Group messages are deleted 30 days after they were sent (read filter here; a TTL policy deletes them). */
const GROUP_MESSAGE_TTL_MS = 30 * 24 * 3600 * 1000;

/** Firestore keeps plain JSON here; a round trip drops undefined and class instances. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Document ids can't hold "/" and are capped in length, so place ids and kv keys are hashed or encoded. */
const kvId = (key: string) => createHash("sha256").update(key).digest("hex");
const placeDoc = (placeId: string) => encodeURIComponent(placeId).slice(0, 700);

interface KvDoc {
  json: string;
  expiresAt: number | null;
}

function firestoreKv(db: Firestore): RepoKv {
  const ref = (key: string) => db.collection(C.kv).doc(kvId(key));
  const live = <T>(d: KvDoc | undefined, now: number): T | null =>
    !d || (d.expiresAt !== null && d.expiresAt <= now) ? null : (JSON.parse(d.json) as T);
  return {
    async get<T>(key: string) {
      const snap = await ref(key).get();
      return live<T>(snap.data() as KvDoc | undefined, Date.now());
    },
    async update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number) {
      return db.runTransaction(async (tx) => {
        const r = ref(key);
        const now = Date.now();
        const cur = live<T>((await tx.get(r)).data() as KvDoc | undefined, now);
        const next = change(cur === null ? null : plain(cur));
        if (next === null) return cur;
        if (next === undefined) {
          tx.delete(r);
          return null;
        }
        const expiresAt = ttlMs === undefined ? null : now + ttlMs;
        tx.set(r, { json: JSON.stringify(next), expiresAt, ...(expiresAt ? { expireAt: Timestamp.fromMillis(expiresAt) } : {}) });
        return plain(next);
      });
    },
    async del(key) {
      await ref(key).delete();
    },
  };
}

/** A Repo over Firestore. `db` defaults to the admin app's database. */
export function firestoreRepo(db: Firestore = adminFirestore()): Repo {
  const accounts = db.collection(C.accounts);
  const usernames = db.collection(C.usernames);
  const entries = (placeId: string) => db.collection(C.podium).doc(placeDoc(placeId)).collection("entries");
  const links = (uid: string) => db.collection(C.friends).doc(uid).collection("links");

  async function deleteQuery(q: Query) {
    for (;;) {
      const snap = await q.limit(300).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 300) return;
    }
  }

  return {
    kind: "firestore",

    accounts: {
      async get(uid) {
        const snap = await accounts.doc(uid).get();
        return snap.exists ? (snap.data() as StoredAccount) : null;
      },
      async create(account) {
        try {
          await accounts.doc(account.uid).create(plain(account));
          return true;
        } catch (err) {
          // ALREADY_EXISTS
          if ((err as { code?: number }).code === 6) return false;
          throw err;
        }
      },
      async update(uid, change) {
        return db.runTransaction(async (tx) => {
          const ref = accounts.doc(uid);
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const next = plain({ ...change(snap.data() as StoredAccount), uid });
          tx.set(ref, next);
          return next;
        });
      },
      async delete(uid) {
        await accounts.doc(uid).delete();
      },
    },

    usernames: {
      async claim(username, uid) {
        return db.runTransaction(async (tx) => {
          const ref = usernames.doc(usernameKey(username));
          const snap = await tx.get(ref);
          const owner = snap.exists ? (snap.data() as { uid: string }).uid : null;
          if (owner && owner !== uid) return false;
          if (!owner) tx.set(ref, { uid });
          return true;
        });
      },
      async owner(username) {
        const snap = await usernames.doc(usernameKey(username)).get();
        return snap.exists ? (snap.data() as { uid: string }).uid : null;
      },
      async release(username, uid) {
        await db.runTransaction(async (tx) => {
          const ref = usernames.doc(usernameKey(username));
          const snap = await tx.get(ref);
          if (snap.exists && (snap.data() as { uid: string }).uid === uid) tx.delete(ref);
        });
      },
    },

    sync: {
      async get(uid) {
        const snap = await db.collection(C.sync).doc(uid).get();
        return snap.exists ? (snap.data() as SyncBlob) : null;
      },
      async put(uid, blob) {
        await db.collection(C.sync).doc(uid).set(plain(blob));
      },
      async delete(uid) {
        await db.collection(C.sync).doc(uid).delete();
      },
    },

    profiles: {
      async get(uid) {
        const snap = await db.collection(C.profiles).doc(uid).get();
        return snap.exists ? (snap.data() as ProfileRecord) : null;
      },
      async put(uid, record) {
        await db.collection(C.profiles).doc(uid).set(plain(record));
      },
      async delete(uid) {
        await db.collection(C.profiles).doc(uid).delete();
      },
    },

    podium: {
      async add(placeId, podiumId, by = 1) {
        return db.runTransaction(async (tx) => {
          const ref = entries(placeId).doc(podiumId);
          const snap = await tx.get(ref);
          const n = ((snap.data()?.visits as number | undefined) ?? 0) + Math.max(0, by);
          tx.set(ref, { visits: n });
          return n;
        });
      },
      async move(placeId, from, to) {
        return db.runTransaction(async (tx) => {
          const fromRef = entries(placeId).doc(from);
          const toRef = entries(placeId).doc(to);
          const [a, b] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
          if (!a.exists) return false;
          if (from === to) return true;
          tx.delete(fromRef);
          tx.set(toRef, { visits: ((b.data()?.visits as number | undefined) ?? 0) + (a.data()!.visits as number) });
          return true;
        });
      },
      async remove(list) {
        for (let i = 0; i < list.length; i += 300) {
          const batch = db.batch();
          list.slice(i, i + 300).forEach(({ placeId, podiumId }) => batch.delete(entries(placeId).doc(podiumId)));
          await batch.commit();
        }
      },
      async top(placeId, n) {
        if (n <= 0) return [];
        // A few extra rows, then the tie order (podiumId) is applied here, so no composite index is needed.
        const snap = await entries(placeId).orderBy("visits", "desc").limit(n + 25).get();
        return snap.docs
          .map((d) => ({ podiumId: d.id, visits: d.data().visits as number }))
          .sort((x, y) => y.visits - x.visits || (x.podiumId < y.podiumId ? -1 : x.podiumId > y.podiumId ? 1 : 0))
          .slice(0, n);
      },
      async participants(placeId) {
        const agg = await entries(placeId).count().get();
        return agg.data().count;
      },
    },

    friends: {
      async list(uid) {
        const snap = await links(uid).get();
        return snap.docs.map((d) => d.data() as FriendLink);
      },
      async are(a, b) {
        return (await links(a).doc(b).get()).exists;
      },
      async add(a, b) {
        if (a === b) return;
        await db.runTransaction(async (tx) => {
          const ab = await tx.get(links(a).doc(b));
          const timesMet = (ab.data()?.timesMet as number | undefined) ?? 0;
          tx.set(links(a).doc(b), { uid: b, timesMet });
          tx.set(links(b).doc(a), { uid: a, timesMet });
        });
      },
      async remove(a, b) {
        const batch = db.batch();
        batch.delete(links(a).doc(b));
        batch.delete(links(b).doc(a));
        await batch.commit();
      },
      async removeAll(uid) {
        const snap = await links(uid).get();
        for (let i = 0; i < snap.docs.length; i += 200) {
          const batch = db.batch();
          snap.docs.slice(i, i + 200).forEach((d) => {
            batch.delete(d.ref);
            batch.delete(links(d.id).doc(uid));
          });
          await batch.commit();
        }
      },
      async bumpTimesMet(a, b) {
        return db.runTransaction(async (tx) => {
          const [ab, ba] = await Promise.all([tx.get(links(a).doc(b)), tx.get(links(b).doc(a))]);
          if (!ab.exists || !ba.exists) return 0;
          const n = ((ab.data()!.timesMet as number) ?? 0) + 1;
          tx.update(ab.ref, { timesMet: n });
          tx.update(ba.ref, { timesMet: n });
          return n;
        });
      },
    },

    invites: {
      async create(invite) {
        await db.collection(C.invites).doc(invite.codeHash).set(plain(invite));
      },
      async take(codeHash, now) {
        return db.runTransaction(async (tx) => {
          const ref = db.collection(C.invites).doc(codeHash);
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          tx.delete(ref);
          const inv = snap.data() as StoredInvite;
          return inv.expiresAt > now ? inv : null;
        });
      },
      async deleteByUid(uid) {
        await deleteQuery(db.collection(C.invites).where("uid", "==", uid));
      },
    },

    groups: {
      async get(id) {
        const snap = await db.collection(C.groups).doc(id).get();
        return snap.exists ? (snap.data() as StoredGroup) : null;
      },
      async create(group) {
        try {
          await db.collection(C.groups).doc(group.id).create(plain(group));
          return true;
        } catch (err) {
          if ((err as { code?: number }).code === 6) return false;
          throw err;
        }
      },
      async update(id, change) {
        return db.runTransaction(async (tx) => {
          const ref = db.collection(C.groups).doc(id);
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const cur = snap.data() as StoredGroup;
          const next = change(plain(cur));
          if (next === null) return cur;
          const out = plain({ ...next, id });
          tx.set(ref, out);
          return out;
        });
      },
      async delete(id) {
        const ref = db.collection(C.groups).doc(id);
        await deleteQuery(ref.collection("messages"));
        await ref.delete();
      },
      async listFor(uid) {
        const snap = await db.collection(C.groups).where("memberUids", "array-contains", uid).limit(100).get();
        return snap.docs.map((d) => d.data() as StoredGroup);
      },
    },

    groupMessages: {
      async add(groupId, message) {
        await db
          .collection(C.groups)
          .doc(groupId)
          .collection("messages")
          .doc(message.id)
          .set({ ...plain(message), expireAt: Timestamp.fromMillis(message.at + GROUP_MESSAGE_TTL_MS) });
      },
      async list(groupId, { sinceAt, limit }) {
        if (limit <= 0) return [];
        const snap = await db
          .collection(C.groups)
          .doc(groupId)
          .collection("messages")
          .where("at", ">=", sinceAt)
          .orderBy("at", "desc")
          .limit(limit)
          .get();
        return snap.docs
          .map((d) => {
            const { expireAt: _e, ...m } = d.data() as StoredGroupMessage & { expireAt?: unknown };
            void _e;
            return m as StoredGroupMessage;
          })
          .reverse();
      },
      async prune(groupId, beforeAt) {
        await deleteQuery(db.collection(C.groups).doc(groupId).collection("messages").where("at", "<", beforeAt));
      },
    },

    blocks: {
      async add(blocker, blocked) {
        if (blocker === blocked) return;
        await db.collection(C.blocks).doc(`${blocker}_${blocked}`).set({ blocker, blocked });
      },
      async between(a, b) {
        const [x, y] = await Promise.all([db.collection(C.blocks).doc(`${a}_${b}`).get(), db.collection(C.blocks).doc(`${b}_${a}`).get()]);
        return x.exists || y.exists;
      },
      async involving(uid) {
        const [mine, theirs] = await Promise.all([
          db.collection(C.blocks).where("blocker", "==", uid).get(),
          db.collection(C.blocks).where("blocked", "==", uid).get(),
        ]);
        return [...new Set([...mine.docs.map((d) => d.data().blocked as string), ...theirs.docs.map((d) => d.data().blocker as string)])];
      },
      async removeAll(uid) {
        await deleteQuery(db.collection(C.blocks).where("blocker", "==", uid));
        await deleteQuery(db.collection(C.blocks).where("blocked", "==", uid));
      },
    },

    kv: firestoreKv(db),
  };
}

