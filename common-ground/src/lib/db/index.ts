import "server-only";
import { hasApplicationDefaultCredentials } from "../firebase/admin";
import { firestoreRepo } from "./firestore";
import { memoryRepo } from "./memory";
import type { Repo } from "./types";

export type * from "./types";

// Picks the Repo: "memory" (Vitest, Playwright, quick local runs) or "firestore".
//   LARRY_DB=memory|firestore wins when set.
//   Unset: firestore in production; in development, firestore when Application Default Credentials
//   are present (gcloud auth application-default login), else memory; memory under Vitest.
// Development without ADC asking for firestore falls back to memory with one clear console line.
// Production never falls back: losing accounts in memory would be worse than failing loudly.

export type RepoKind = Repo["kind"];

export function repoKind(): RepoKind {
  const want = process.env.LARRY_DB;
  if (want === "memory" || want === "firestore") return want;
  if (process.env.NODE_ENV === "production") return "firestore";
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "memory";
  return hasApplicationDefaultCredentials() ? "firestore" : "memory";
}

const g = globalThis as typeof globalThis & { __larryFirestoreRepo?: Repo; __larryRepoWarned?: boolean };

function warnMemoryOnce() {
  if (g.__larryRepoWarned) return;
  g.__larryRepoWarned = true;
  console.warn(
    "[larry] No Application Default Credentials found, so this dev server uses the in-memory database " +
      "(accounts are lost on restart). Run `gcloud auth application-default login` to use Firestore, " +
      "or set LARRY_DB=memory to hide this line.",
  );
}

export function getRepo(): Repo {
  const dev = process.env.NODE_ENV === "development";
  if (repoKind() === "memory") {
    if (dev && process.env.LARRY_DB !== "memory") warnMemoryOnce();
    return memoryRepo();
  }
  if (process.env.NODE_ENV !== "production" && !hasApplicationDefaultCredentials()) {
    warnMemoryOnce();
    return memoryRepo();
  }
  return (g.__larryFirestoreRepo ??= firestoreRepo());
}
