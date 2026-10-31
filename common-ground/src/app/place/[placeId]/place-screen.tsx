"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { deviceAlias } from "@/components/profile/device-podium";
import { loadPodium, rerollPodiumName, type Loaded } from "@/components/profile/profile-api";
import { Door, visitsWord } from "@/components/profile/profile-view";
import { SiteHeader } from "@/components/site-header";
import { TitleBadge } from "@/components/title-badge";
import { Button, Skeleton } from "@/components/ui";
import { VenuePodium } from "@/components/venue-podium";
import { APP_NAME } from "@/lib/brand";
import { useCounters } from "@/lib/checkins";
import { nextStage, TITLES } from "@/lib/titles";
import type { PodiumResponse } from "@/lib/types/people";

// The place page (/place/<id>): the podium with anonymous per-place names, the person's own stage
// (from this phone; only they see it) and a door: Larry's repeat-or-stretch next step. No visit
// numbers on the podium, no profile links, no times.

export function PlaceScreen({ placeId }: { placeId: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <React.Suspense fallback={<div className="flex-1" />}>
        <PlaceBody placeId={placeId} />
      </React.Suspense>
    </div>
  );
}

function PlaceBody({ placeId }: { placeId: string }) {
  const params = useSearchParams();
  const counters = useCounters();
  const { status } = useAuth();
  const mine = counters?.find((c) => c.placeId === placeId) ?? null;
  // The name in the link is only a label until the place loads: control characters and angle brackets out.
  const fromUrl = (params.get("name") ?? "").replace(/[\p{C}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const placeName = mine?.placeName || fromUrl || "This place";

  const [podium, setPodium] = React.useState<Loaded<PodiumResponse> | null>(null);
  const [alias, setAlias] = React.useState<string | null>(null);
  const [epoch, setEpoch] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    void loadPodium(placeId).then((r) => live && setPodium(r));
    void deviceAlias(placeId).then((a) => live && setAlias(a));
    return () => {
      live = false;
    };
  }, [placeId, epoch]);

  const next = mine && mine.visits > 0 ? nextStage(mine.visits) : null;
  const stageId = mine?.stage ?? null;

  const repeat = mine && mine.visits > 0;
  const doorLine = repeat
    ? `Same place next week?${next ? ` ${TITLES[next.stage].word} is ${visitsWord(next.visitsAway)} away.` : " You're a Legend here already."} Or stretch a little: I can find somewhere one notch livelier.`
    : `Want to make ${placeName === "This place" ? "this" : placeName} your place? Check in when you're there and stay 20 minutes.`;

  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 pb-16 sm:px-8">
      <h1 className="font-display text-title-page font-black leading-title break-words">{placeName}</h1>

      {stageId && mine && (
        <section aria-labelledby="your-stage" className="flex flex-col gap-3 rounded-panel bg-paper p-4 ring-2 ring-line sm:p-5">
          <h2 id="your-stage" className="font-display text-title-sm font-black">
            Your stage here
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <TitleBadge id={stageId} size="lg" info srDetail="Only you can see this." />
            <p>
              {visitsWord(mine.visits)} counted.
              {mine.spotWeeks >= 2 ? ` ${mine.spotWeeks} weeks here.` : ""}
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-label text-ink-soft">
            <Lock className="size-4 shrink-0" aria-hidden /> Only you see this. We keep counts, not a diary.
          </p>
        </section>
      )}

      {podium === null ? (
        <div role="status" className="flex flex-col gap-2 rounded-panel border-2 border-dashed border-line p-4">
          <span className="sr-only">Loading the top 3.</span>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : podium.kind === "ok" ? (
        <VenuePodium
          placeName={placeName}
          open={podium.data.open}
          entries={podium.data.entries}
          myAlias={alias}
          onReroll={
            status === "signed-in"
              ? async () => {
                  const ok = await rerollPodiumName(placeId);
                  if (ok) setEpoch((n) => n + 1);
                  return ok;
                }
              : undefined
          }
        />
      ) : podium.kind === "unavailable" ? (
        <p className="rounded-panel bg-paper p-4 ring-2 ring-line">This place has no top 3 on {APP_NAME} yet.</p>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-panel bg-paper p-4 ring-2 ring-line">
          <p>Hmm, that didn&apos;t load. Try again in a moment?</p>
          <Button variant="secondary" size="sm" onClick={() => setEpoch((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      <Door
        line={doorLine}
        cta={repeat ? { label: "Plan my next visit", href: "/larry?ask=place" } : { label: "See my next move", href: "/" }}
        alt={repeat ? { label: "Somewhere livelier", href: "/larry?ask=place&vibe=lively" } : undefined}
      />
    </main>
  );
}
