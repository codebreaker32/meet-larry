"use client";

import * as React from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Skeleton } from "@/components/ui";
import { useCounters, type PlaceCounter } from "@/lib/checkins";
import { shownGlory, useGlory } from "@/lib/glory";
import { nextStage } from "@/lib/titles";
import type { OwnerPlace, OwnerProfile } from "@/lib/types/profile";
import { cn } from "@/lib/utils";
import { loadProfile, type Loaded } from "./profile-api";
import { OwnerView } from "./profile-view";

/** The owner's places from this phone's counters (verified visits only; "Visited" places have no stage). */
export function placesFromCounters(counters: readonly Pick<PlaceCounter, "placeId" | "placeName" | "visits" | "stage" | "spotWeeks">[]): OwnerPlace[] {
  const out: OwnerPlace[] = [];
  for (const c of counters) {
    if (!c.stage || c.visits < 1) continue;
    const next = nextStage(c.visits);
    out.push({
      venue: { placeId: c.placeId, placeName: c.placeName },
      stage: c.stage,
      visits: c.visits,
      weeks: c.spotWeeks,
      ...(next ? { nextStage: next } : {}),
    });
  }
  return out.sort((a, b) => b.visits - a.visits);
}

/** A device-only owner profile: no username, no public or friend titles. */
export function deviceOwnerProfile(counters: readonly PlaceCounter[], glory: number): OwnerProfile {
  return {
    viewer: "owner",
    username: "",
    displayName: "",
    glory: Math.max(0, glory),
    places: placesFromCounters(counters),
    publicTitles: [],
    friendTitles: [],
    sharingWithFriends: false,
    showOnLeaderboards: false,
  };
}

/**
 * The owner's own profile at the top of /me: Glory, the near-title line, all 13 badges, titles with
 * their venues and place names, and the private places list. Signed in: the server's OwnerProfile,
 * with Glory shown as max(device, server) so it never looks like it dropped, and this phone's counters
 * when they know more places. Device only: the same view from this phone.
 */
export function OwnerSection({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { status, account } = useAuth();
  const counters = useCounters();
  const deviceGlory = useGlory();
  const [server, setServer] = React.useState<Loaded<OwnerProfile> | null>(null);
  const username = status === "signed-in" ? account?.username : undefined;

  React.useEffect(() => {
    if (!username) return;
    let live = true;
    void loadProfile(username).then((r) => {
      if (!live) return;
      if (r.kind === "ok" && r.data.viewer === "owner") setServer({ kind: "ok", data: r.data });
      else setServer(r.kind === "ok" ? { kind: "error" } : r);
    });
    return () => {
      live = false;
    };
  }, [username]);

  if (counters === undefined || deviceGlory === undefined || status === "loading" || (username && server === null)) {
    return (
      <div role="status" className={cn("flex flex-col gap-3", className)}>
        <span className="sr-only">Loading your profile.</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-2/3" />
      </div>
    );
  }

  const local = placesFromCounters(counters);
  let profile: OwnerProfile;
  if (username && account) {
    const s = server?.kind === "ok" ? server.data : null;
    profile = {
      ...(s ?? deviceOwnerProfile(counters, 0)),
      viewer: "owner",
      username: s?.username || account.username,
      displayName: s?.displayName || account.name,
      glory: shownGlory(deviceGlory, Math.max(s?.glory ?? 0, account.glory ?? 0)),
      places: s && s.places.length >= local.length ? s.places : local,
    };
  } else {
    profile = deviceOwnerProfile(counters, deviceGlory);
  }

  return (
    <section id="profile" aria-label="Your profile" className={cn("scroll-mt-20", className)}>
      <OwnerView profile={profile} deviceOnly={!username} headingLevel={2}>
        {children}
      </OwnerView>
    </section>
  );
}
