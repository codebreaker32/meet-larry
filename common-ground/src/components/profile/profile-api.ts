// Client calls for profiles, podiums and friends (shapes from src/lib/types/people.ts and profile.ts).
// The server types every profile by viewer before it leaves, so nothing here filters or hides.
import { authFetch } from "@/lib/firebase/client";
import type { Friend, FriendsResponse, PodiumResponse } from "@/lib/types/people";
import type { ProfileData } from "@/lib/types/profile";
import { rerollKeys, saveRerollCount } from "./device-podium";

export type Loaded<T> = { kind: "ok"; data: T } | { kind: "unavailable" } | { kind: "error" };

/**
 * GET /api/profile/<username>. 404 and 403 both read as "unavailable", the same words for a blocked,
 * deleted or unknown name, so a block is never revealed.
 */
export async function loadProfile(username: string): Promise<Loaded<ProfileData>> {
  try {
    const res = await authFetch(`/api/profile/${encodeURIComponent(username)}`, { cache: "no-store" });
    if (res.status === 404 || res.status === 403 || res.status === 410) return { kind: "unavailable" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as ProfileData;
    if (!data || (data.viewer !== "owner" && data.viewer !== "friend" && data.viewer !== "stranger")) return { kind: "error" };
    return { kind: "ok", data };
  } catch {
    return { kind: "error" };
  }
}

/** GET /api/podium/<placeId>: public, no auth, no "mine". */
export async function loadPodium(placeId: string): Promise<Loaded<PodiumResponse>> {
  try {
    const res = await fetch(`/api/podium/${encodeURIComponent(placeId)}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "unavailable" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as PodiumResponse };
  } catch {
    return { kind: "error" };
  }
}

/** POST /api/podium/<placeId> {oldKey, newKey}: a new made-up name at this place. Returns true when it moved. */
export async function rerollPodiumName(placeId: string): Promise<boolean> {
  try {
    const { oldKey, newKey, next } = await rerollKeys(placeId);
    const res = await authFetch(`/api/podium/${encodeURIComponent(placeId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldKey, newKey }),
    });
    if (!res.ok) return false;
    saveRerollCount(placeId, next);
    return true;
  } catch {
    return false;
  }
}

export async function loadFriends(): Promise<Loaded<Friend[]>> {
  try {
    const res = await authFetch("/api/friends", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { kind: "unavailable" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as FriendsResponse;
    return { kind: "ok", data: Array.isArray(data?.friends) ? data.friends : [] };
  } catch {
    return { kind: "error" };
  }
}

/** DELETE /api/friends {uid}: silent and immediate. Nobody is told. */
export async function unfriend(uid: string): Promise<boolean> {
  try {
    const res = await authFetch("/api/friends", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** PUT /api/friends {sharing}: "Show my check-ins to friends". */
export async function saveSharing(sharing: boolean): Promise<boolean> {
  try {
    const res = await authFetch("/api/friends", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sharing }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
