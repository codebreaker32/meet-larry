import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Group join tokens (the QR). Signed, not stored: "<groupId>.<nonce>.<expiresAt>.<sig>". The group
// keeps its current nonce, so closing joining, removing someone or showing a fresh QR changes the
// nonce and every earlier QR stops working at once. The token holds no uid, name or username.

const g = globalThis as typeof globalThis & { __larryGroupSecret?: string };

function secret(): string {
  const env = process.env.GROUPS_SECRET || process.env.CHECKIN_SECRET || process.env.MEET_SECRET;
  if (env && env.length >= 32) return env;
  // One dev server or a test: a per-process secret is fine (a restart only cancels open QRs).
  return (g.__larryGroupSecret ??= randomBytes(32).toString("base64url"));
}

const key = () => createHash("sha256").update(`larry-group-join\u0000${secret()}`).digest();
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);

const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** A new random group id (128 bits). */
export const newGroupId = () => randomBytes(16).toString("base64url");
/** A new join nonce. */
export const newJoinNonce = () => randomBytes(9).toString("base64url");
/** A new per-group member id or message id. */
export const newShortId = () => randomBytes(9).toString("base64url");

export function makeJoinToken(groupId: string, nonce: string, expiresAt: number): string {
  const body = `${groupId}.${nonce}.${Math.floor(expiresAt)}`;
  return `${body}.${sign(body)}`;
}

export interface JoinClaims {
  groupId: string;
  nonce: string;
  expiresAt: number;
}

/** The token's claims when its signature is right (expiry is checked by the caller), else null. */
export function readJoinToken(token: unknown): JoinClaims | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [groupId, nonce, exp, sig] = parts;
  if (!ID_RE.test(groupId) || !NONCE_RE.test(nonce) || !/^\d{10,15}$/.test(exp)) return null;
  const want = Buffer.from(sign(`${groupId}.${nonce}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { groupId, nonce, expiresAt: Number(exp) };
}

/** True for something shaped like a group id (route params). */
export const isGroupId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);
