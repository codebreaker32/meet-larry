"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { loadFriends, loadProfile, unfriend, type Loaded } from "@/components/profile/profile-api";
import { ProfileView } from "@/components/profile/profile-view";
import { LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { Button, Skeleton } from "@/components/ui";
import type { ProfileData } from "@/lib/types/profile";

// /profile/<username> (/u/<name> redirects here; usernames carry no "u/"): one profile, typed by viewer on the server. A stranger sees the username and public
// title counts only; a friend sees venues when both share; the owner is sent to /me, where everything is.
// A blocked, deleted or unknown name gets the same words, so a block is never revealed.

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9]{2,39}$/;

export function ProfileScreen({ username }: { username: string }) {
  const router = useRouter();
  const { status } = useAuth();
  const [state, setState] = React.useState<Loaded<ProfileData> | null>(null);
  const [gone, setGone] = React.useState<string | null>(null);
  const [epoch, setEpoch] = React.useState(0);
  const valid = USERNAME_RE.test(username);

  React.useEffect(() => {
    if (status === "loading" || !valid) return;
    let live = true;
    void loadProfile(username).then((r) => {
      if (!live) return;
      // The owner's full profile lives on /me (settings, friends and all).
      if (r.kind === "ok" && r.data.viewer === "owner") router.replace("/me#profile");
      setState(r);
    });
    return () => {
      live = false;
    };
  }, [username, valid, status, epoch, router]);

  const onUnfriend = async () => {
    const list = await loadFriends();
    const f = list.kind === "ok" ? list.data.find((x) => x.username.toLowerCase() === username.toLowerCase()) : undefined;
    if (!f || !(await unfriend(f.uid))) {
      setGone("Hmm, that didn't go through. Try again in a moment?");
      return;
    }
    setGone(`Done. You and ${f.displayName} aren't friends any more.`);
    setEpoch((n) => n + 1);
  };

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-5 pb-16 sm:px-8">
        <p role="status" aria-live="polite" className="font-bold empty:hidden">
          {gone}
        </p>
        {!valid ? (
          <Unavailable />
        ) : state === null ? (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading the profile.</span>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        ) : state.kind === "ok" ? (
          state.data.viewer === "owner" ? null : (
            <ProfileView
              profile={state.data}
              onUnfriend={state.data.viewer === "friend" ? onUnfriend : undefined}
              onBlocked={() => {
                setGone("Done. You won't see each other on Larry again.");
                setState({ kind: "unavailable" });
              }}
            />
          )
        ) : state.kind === "unavailable" ? (
          <Unavailable />
        ) : (
          <section className="flex max-w-md flex-col items-start gap-4 py-8">
            <h1 className="font-display text-title-lg font-black leading-title">Hmm, that didn&apos;t load.</h1>
            <p className="text-lead text-ink-soft">Try again in a moment?</p>
            <Button variant="secondary" onClick={() => setEpoch((n) => n + 1)}>
              Try again
            </Button>
          </section>
        )}
      </main>
    </div>
  );
}

/** The same words for a blocked, deleted or unknown name, so a block is never revealed. */
function Unavailable() {
  return (
    <section className="flex max-w-md flex-col items-start gap-4 py-8">
      <h1 className="font-display text-title-lg font-black leading-title">This profile isn&apos;t available.</h1>
      <p className="text-lead text-ink-soft">Friends on Larry meet in person first, by scanning a group QR.</p>
      <LinkButton href="/">Go home</LinkButton>
    </section>
  );
}
