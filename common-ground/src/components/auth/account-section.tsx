"use client";

import * as React from "react";
import { CircleUserRound, LogOut, Trash2, Trophy } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { Button, Dialog, Skeleton, Switch } from "@/components/ui";
import { podiumKey } from "@/lib/alias";
import { authFetch } from "@/lib/firebase/client";
import type { Account } from "@/lib/types/account";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";

// The account panel on /me (1E mounts it). Signed out: why an account helps and one button.
// Signed in: the public username, Larry time left in words, "Show me on place leaderboards" (D12,
// off by default), sign out, and delete everything in one place.

const BUDGET_CENTS = 25;

/** Larry time in words, no numbers to worry about. */
export function larryTimeWords(centsLeft: number): string {
  const left = Math.max(0, centsLeft) / BUDGET_CENTS;
  if (left <= 0) return "That's your Larry time for now! Everything else (your card, places, plans) still works.";
  if (left > 0.9) return "All of your Larry time is left.";
  if (left > 0.6) return "Most of your Larry time is left.";
  if (left > 0.35) return "About half of your Larry time is left.";
  if (left > 0.1) return "A little Larry time is left.";
  return "Your Larry time is nearly used up.";
}

const readRaw = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const parse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
};

/** This device's podium keys for every place it has counted, so deletion can remove them (only the device knows them). */
async function devicePodiumKeys(): Promise<{ placeId: string; key: string }[]> {
  const secret = parse<string | null>(readRaw(STORAGE_KEYS.deviceSecret), null);
  if (typeof secret !== "string" || !secret) return [];
  const counters = parse<{ placeId?: string }[]>(readRaw(STORAGE_KEYS.placeCounters), []);
  const rerolls = parse<Record<string, number>>(readRaw(STORAGE_KEYS.podiumRerolls), {});
  const out: { placeId: string; key: string }[] = [];
  for (const c of Array.isArray(counters) ? counters.slice(0, 200) : []) {
    if (!c?.placeId) continue;
    const n = Math.max(0, Number(rerolls?.[c.placeId] ?? 0) || 0);
    // The current key and the ones before any re-roll (a re-roll moves the count, but be thorough).
    for (let r = 0; r <= Math.min(n, 5); r++) out.push({ placeId: c.placeId, key: await podiumKey(secret, c.placeId, r) });
  }
  return out;
}

export function AccountSection({ className }: { className?: string }) {
  const { status, account } = useAuth();
  return (
    <section id="account" aria-labelledby="account-title" className={cn("scroll-mt-20 rounded-panel border-2 border-ink bg-paper p-4 sm:p-5", className)}>
      <h2 id="account-title" className="font-display text-title-sm font-black">
        Your account
      </h2>
      {status === "loading" && (
        <div role="status" className="mt-3 flex flex-col gap-2">
          <span className="sr-only">Loading your account.</span>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {status === "signed-out" && (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="max-w-measure">
            Keep your progress if you change phones, and get your own Larry time. For 18 and over. We keep counts, not a diary.
          </p>
          <LinkButton href="/signin?next=%2Fme%23account">Sign in with your phone</LinkButton>
        </div>
      )}
      {status === "needs-signup" && (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="max-w-measure">Your phone is checked. Two quick questions and your account is ready.</p>
          <LinkButton href="/signup?next=%2Fme%23account">Finish sign-up</LinkButton>
        </div>
      )}
      {status === "signed-in" && account && <SignedIn account={account} />}
    </section>
  );
}

function SignedIn({ account }: { account: Account }) {
  const { setAccount, signOut } = useAuth();
  const [saving, setSaving] = React.useState(false);
  const [shown, setShown] = React.useState(account.showOnLeaderboards);
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const keepRef = React.useRef<HTMLButtonElement>(null);

  async function toggle(next: boolean) {
    if (saving) return;
    setShown(next);
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showOnLeaderboards: next }),
      });
      if (!res.ok) throw new Error("not saved");
      const a = (await res.json()) as Account;
      setAccount(a);
      try {
        localStorage.setItem(STORAGE_KEYS.podiumOptIn, JSON.stringify(a.showOnLeaderboards));
      } catch {}
      setSaid(
        a.showOnLeaderboards
          ? "You're on. From your next check-in, you can show up on a place's top 3 under a made-up name."
          : "You're off every place leaderboard. Your own progress still counts.",
      );
    } catch {
      setShown(!next);
      setError("Hmm, that didn't save. Try again in a moment?");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    if (deleting) return;
    setDeleting(true);
    try {
      const keys = await devicePodiumKeys().catch(() => []);
      if (keys.length) {
        await authFetch("/api/podium/mine", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keys }),
        }).catch(() => null);
      }
      const res = await authFetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new Error("not deleted");
      try {
        localStorage.removeItem(STORAGE_KEYS.lastSync);
        localStorage.setItem(STORAGE_KEYS.podiumOptIn, "false");
      } catch {}
      setConfirming(false);
      await signOut();
    } catch {
      setError("Hmm, that didn't go through. Your account is still here. Try again in a moment?");
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
          <CircleUserRound className="size-5" />
        </span>
        <p className="leading-snug">
          Signed in as <span className="font-bold">{account.username}</span>. That&apos;s the only name other people see.
        </p>
      </div>
      <p>{larryTimeWords(account.budgetCentsLeft)}</p>

      <div className="flex flex-col gap-1.5">
        <Switch
          checked={shown}
          onCheckedChange={(v) => void toggle(v)}
          busy={saving}
          icon={<Trophy className="size-5" />}
          label="Show me on place leaderboards"
          description="Off: your visits still count for your own stages and Glory. On: you can appear in a place's top 3, under a different made-up name at each place. Nobody can message you from there."
        />
        {error && (
          <p role="alert" className="font-bold text-danger">
            {error}
          </p>
        )}
        <p role="status" className="sr-only">
          {said}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t-2 border-line pt-4">
        <Button variant="secondary" icon={<LogOut />} onClick={() => void signOut()}>
          Sign out
        </Button>
        <Button variant="quiet" icon={<Trash2 />} onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(o) => !deleting && setConfirming(o)}
        size="sm"
        icon={<Trash2 className="size-5" />}
        title="Delete your account?"
        description="This removes your account, username, synced counts, Glory, friends, group memberships and leaderboard spots. Your taste card is kept."
        initialFocus={keepRef}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button ref={keepRef} variant="secondary" onClick={() => setConfirming(false)}>
            Keep my account
          </Button>
          <Button loading={deleting} icon={<Trash2 />} onClick={() => void deleteAll()}>
            {deleting ? "Deleting…" : "Delete it all"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
