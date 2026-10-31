"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, UserMinus, Users } from "lucide-react";
import { Button, Skeleton, Switch } from "@/components/ui";
import { DEMO_FRIEND_LABEL, GROUP_WORD } from "@/lib/groups/shared";
import { GROUP_START_HREF } from "@/lib/next-move";
import type { Friend } from "@/lib/types/people";
import { cn } from "@/lib/utils";
import { loadFriends, saveSharing, unfriend, type Loaded } from "./profile-api";
import { Door, profileHref } from "./profile-view";

/** The API also marks the demo account's made-up demo friends; they get a label and no profile link. */
type FriendRow = Friend & { isDemoFriend?: boolean };

/**
 * Your friends (signed-in owner only, on /me). Friends are the people you share a group with: joining
 * by QR is the consent. Each row has one-tap Unfriend: silent and immediate, nobody is told. The
 * "Show my check-ins to friends" switch sits on top (off by default, D1).
 */
export function FriendsList({ sharingWithFriends, className }: { sharingWithFriends: boolean; className?: string }) {
  const [state, setState] = React.useState<Loaded<Friend[]> | null>(null);
  const [sharing, setSharing] = React.useState(sharingWithFriends);
  const [savingShare, setSavingShare] = React.useState(false);
  const [busyUid, setBusyUid] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState("");

  React.useEffect(() => {
    let live = true;
    void loadFriends().then((r) => {
      if (live) setState(r);
    });
    return () => {
      live = false;
    };
  }, []);

  const flipSharing = async (next: boolean) => {
    if (savingShare) return;
    setSharing(next);
    setSavingShare(true);
    const ok = await saveSharing(next);
    setSavingShare(false);
    if (!ok) {
      setSharing(!next);
      setSaid("Hmm, that didn't save. Try again in a moment?");
      return;
    }
    setSaid(next ? "Done. Friends who share too can see which places your titles are at." : "Done. Friends now see your title counts only.");
  };

  const drop = async (f: Friend) => {
    if (busyUid) return;
    setBusyUid(f.uid);
    const ok = await unfriend(f.uid);
    setBusyUid(null);
    if (!ok) {
      setSaid("Hmm, that didn't go through. Try again in a moment?");
      return;
    }
    setState((s) => (s?.kind === "ok" ? { kind: "ok", data: s.data.filter((x) => x.uid !== f.uid) } : s));
    setSaid(`Done. You and ${f.displayName} aren't friends any more.`);
  };

  return (
    <section id="friends" aria-labelledby="friends-title" className={cn("flex scroll-mt-20 flex-col gap-4", className)}>
      <h2 id="friends-title" className="font-display text-title-sm font-black">
        Your friends
      </h2>
      <Switch
        checked={sharing}
        onCheckedChange={(v) => void flipSharing(v)}
        busy={savingShare}
        icon={<Eye className="size-5" />}
        label="Show my check-ins to friends"
        description="Friends who share too see which places your titles are at. Off by default. Turn it off any time; nobody is told."
      />
      <p role="status" aria-live="polite" className="font-bold empty:hidden">
        {said}
      </p>

      {state === null ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Loading your friends.</span>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : state.kind === "ok" && state.data.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Friends">
          {state.data.map((f: FriendRow) => (
            <li key={f.uid} className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-border-subtle bg-paper p-3" data-friend-row>
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
                <Users className="size-5" />
              </span>
              <div className="min-w-40 flex-1">
                {f.isDemoFriend ? (
                  <p className="font-bold">
                    {f.displayName} <span className="font-normal text-ink-soft">({DEMO_FRIEND_LABEL})</span>
                  </p>
                ) : (
                  <Link href={profileHref(f.username)} className="font-bold underline decoration-2 underline-offset-4 hover:decoration-ink">
                    {f.displayName}
                  </Link>
                )}
                <p className="text-label text-ink-soft">
                  {f.isDemoFriend ? "Made up for testing. Not a real person." : f.username}
                  {f.sharing ? ". You both share your places." : ""}
                </p>
              </div>
              <Button variant="quiet" size="sm" icon={<UserMinus />} loading={busyUid === f.uid} onClick={() => void drop(f)}>
                Unfriend<span className="sr-only"> {f.displayName}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : state.kind === "error" ? (
        <p className="text-ink-soft">Hmm, your friends didn&apos;t load. Try again in a moment?</p>
      ) : (
        <Door
          line={`Friends start in person. Start a ${GROUP_WORD.toLowerCase()}, show the QR, and whoever scans it joins. I'll find what you share.`}
          cta={{ label: `Start a ${GROUP_WORD.toLowerCase()}`, href: GROUP_START_HREF }}
        />
      )}
      {state?.kind === "ok" && state.data.length > 0 && (
        <p className="max-w-measure text-label text-ink-soft">
          Unfriend is one tap and nobody is told. New friends come from a {GROUP_WORD.toLowerCase()} QR, in person.
        </p>
      )}
    </section>
  );
}
