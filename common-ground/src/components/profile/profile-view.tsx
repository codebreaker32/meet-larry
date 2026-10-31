"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Lock, MapPin, UserMinus } from "lucide-react";
import { BadgeShelf, earnedBadges } from "@/components/badges";
import { GloryCount } from "@/components/glory-count";
import { LarryAvatar } from "@/components/larry-avatar";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { TitleBadge } from "@/components/title-badge";
import { Button } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { TITLES } from "@/lib/titles";
import type {
  FriendProfile,
  OwnerPlace,
  OwnerProfile,
  ProfileData,
  StrangerProfile,
  VenueRef,
} from "@/lib/types/profile";
import { cn } from "@/lib/utils";
import { FriendSafety } from "./friend-safety";
import { ProfileHeader } from "./profile-header";

// One profile, three audiences (component-specs 1, C2). The server types the data by viewer before it
// leaves, so each view renders only what it is passed: StrangerProfile has no venue field at all, and
// nothing here hides anything with CSS. Empty sections are left out, never "0 titles".

export const placesWord = (n: number) => `${n} ${n === 1 ? "place" : "places"}`;
export const visitsWord = (n: number) => `${n} ${n === 1 ? "visit" : "visits"}`;

/** A profile link. Never "/u/<name>": Larry is not Reddit. */
export const profileHref = (username: string) =>
  `/profile/${encodeURIComponent(username)}`;

/** The place page link. The name rides along so the page can say it before anything loads. */
export const placeHref = (v: VenueRef) =>
  `/place/${encodeURIComponent(v.placeId)}?name=${encodeURIComponent(v.placeName)}`;

export function ProfileView({
  profile,
  onUnfriend,
  onBlocked,
  ownerExtras,
  headingLevel = 1,
}: {
  profile: ProfileData;
  /** Friend view: one tap, silent and immediate. */
  onUnfriend?: () => void | Promise<void>;
  /** Friend view: after Block or Report went through. */
  onBlocked?: () => void;
  /** Owner view: settings and other panels the page adds after the titles. */
  ownerExtras?: React.ReactNode;
  headingLevel?: 1 | 2;
}) {
  if (profile.viewer === "stranger")
    return <StrangerView profile={profile} headingLevel={headingLevel} />;
  if (profile.viewer === "friend")
    return (
      <FriendView
        profile={profile}
        onUnfriend={onUnfriend}
        onBlocked={onBlocked}
        headingLevel={headingLevel}
      />
    );
  return (
    <OwnerView profile={profile} headingLevel={headingLevel}>
      {ownerExtras}
    </OwnerView>
  );
}

/* ------------------------------------------------------------------ stranger */

/** Username and public title counts only: "Final Boss at 2 places". No venues, Glory or stages. */
export function StrangerView({
  profile,
  headingLevel = 1,
}: {
  profile: StrangerProfile;
  headingLevel?: 1 | 2;
}) {
  const titles = profile.publicTitles.filter((t) => t.places > 0);
  return (
    <div className="flex flex-col gap-6" data-viewer="stranger">
      <ProfileHeader
        username={profile.username}
        as={headingLevel === 1 ? "h1" : "h2"}
      />
      {titles.length > 0 && (
        <section
          aria-labelledby="public-titles"
          className="flex flex-col gap-3"
        >
          <h2
            id="public-titles"
            className="font-display text-title-sm font-black"
          >
            Titles
          </h2>
          <ul className="flex flex-wrap gap-3">
            {titles.map((t) => (
              <li key={t.title}>
                <TitleBadge
                  id={t.title}
                  detail={`at ${placesWord(t.places)}`}
                  info
                />
              </li>
            ))}
          </ul>
          <p className="max-w-measure text-ink-soft">
            Earned by real visits. Where they were earned stays private.
          </p>
        </section>
      )}
      <Door
        line={`On ${APP_NAME}, people become friends in person: one scans the other's QR. Want to try it?`}
        cta={{ label: "Make my taste card", href: "/create" }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ friend */

export function FriendView({
  profile,
  onUnfriend,
  onBlocked,
  headingLevel = 1,
}: {
  profile: FriendProfile;
  onUnfriend?: () => void | Promise<void>;
  onBlocked?: () => void;
  headingLevel?: 1 | 2;
}) {
  const [busy, setBusy] = React.useState(false);
  const sharing = profile.sharing;
  return (
    <div className="flex flex-col gap-6" data-viewer="friend">
      <ProfileHeader
        username={profile.username}
        displayName={profile.displayName}
        as={headingLevel === 1 ? "h1" : "h2"}
      />
      {sharing ? (
        <>
          {typeof profile.glory === "number" && profile.glory > 0 && (
            <GloryCount value={profile.glory} size="chip" />
          )}
          <VenueTitles
            heading="Titles"
            items={profile.publicTitles}
            id="friend-public"
          />
          <VenueTitles
            heading="Among friends"
            items={profile.friendTitles}
            id="friend-friends"
          />
          {profile.publicTitles.length === 0 &&
            profile.friendTitles.length === 0 && (
              <p className="max-w-measure text-ink-soft">
                No titles yet. They come from real visits.
              </p>
            )}
        </>
      ) : (
        <p className="max-w-measure rounded-mini bg-paper p-3 ring-2 ring-line">
          {profile.displayName} keeps their places to themselves for now.
        </p>
      )}
      <Door
        line={`Seeing ${profile.displayName} soon? I can pick a calm, open place and make you a Plan Ticket.`}
        cta={{
          label: `Pick a place with ${APP_NAME}`,
          href: "/larry?ask=place",
        }}
      />
      {onUnfriend && (
        <div className="flex flex-col items-start gap-1 border-t-2 border-line pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="quiet"
              icon={<UserMinus />}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onUnfriend();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Unfriend {profile.displayName}
            </Button>
            <FriendSafety
              username={profile.username}
              who={profile.displayName}
              onDone={onBlocked}
            />
          </div>
          <p className="mt-1 max-w-measure text-label text-ink-soft">
            One tap, and you&apos;re not friends any more. Nobody is told.
          </p>
        </div>
      )}
    </div>
  );
}

function VenueTitles({
  heading,
  items,
  id,
}: {
  heading: string;
  items: { title: keyof typeof TITLES; venue: VenueRef }[];
  id: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-title-sm font-black">
        {heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((t) => (
          <li
            key={`${t.title}-${t.venue.placeId}`}
            className="flex flex-wrap items-center gap-2"
          >
            <TitleBadge id={t.title} detail={`at ${t.venue.placeName}`} info />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ owner */

/** The owner's nearest next stage, only when it's close (2 visits or fewer): "Veteran is 2 visits away at Café Condi." */
export function nearTitleLine(places: OwnerPlace[]): string | null {
  const close = places
    .filter((p) => p.nextStage && p.nextStage.visitsAway <= 2)
    .sort((a, b) => a.nextStage!.visitsAway - b.nextStage!.visitsAway)[0];
  if (!close?.nextStage) return null;
  const n = close.nextStage.visitsAway;
  return `${TITLES[close.nextStage.stage].word} is ${n === 1 ? "one visit" : `${n} visits`} away at ${close.venue.placeName}.`;
}

export function OwnerView({
  profile,
  deviceOnly = false,
  headingLevel = 1,
  children,
}: {
  profile: OwnerProfile;
  /** No account: no username, no public or friend titles; private stages and Glory on this phone. */
  deviceOnly?: boolean;
  headingLevel?: 1 | 2;
  children?: React.ReactNode;
}) {
  const earned = earnedBadges({
    glory: profile.glory,
    stages: profile.places.map((p) => p.stage),
    publicTitles: profile.publicTitles.map((t) => t.title),
    friendTitles: profile.friendTitles.map((t) => t.title),
  });
  const near = nearTitleLine(profile.places);
  const nothingYet = profile.places.length === 0 && profile.glory <= 0;
  const H = headingLevel === 1 ? "h2" : "h3";

  return (
    <div className="flex flex-col gap-8" data-viewer="owner">
      {deviceOnly && headingLevel === 2 && (
        <h2 className="font-display text-title-sm font-black">Your progress</h2>
      )}
      {!deviceOnly && profile.username && (
        <ProfileHeader
          username={profile.username}
          displayName={profile.displayName}
          note="Your username is the only name other people see."
          as={headingLevel === 1 ? "h1" : "h2"}
        />
      )}

      {nothingYet ? (
        <Door
          line="Your first title is one visit away. Check in at any place on a plan, and stay 20 minutes."
          cta={{ label: "See my next move", href: "/" }}
        />
      ) : (
        <>
          <GloryCount value={profile.glory} size="hero" />
          {(profile.rivalry || near) && (
            <Door
              line={[profile.rivalry, near].filter(Boolean).join(" ")}
              cta={{ label: "Plan my next visit", href: "/larry?ask=place" }}
            />
          )}
        </>
      )}

      <section aria-labelledby="badges-title" className="flex flex-col gap-3">
        <H id="badges-title" className="font-display text-title-sm font-black">
          Your badges
        </H>
        <p className="max-w-measure text-ink-soft">
          All 13. Each one comes from real visits. Tap one to see what it means.
        </p>
        <BadgeShelf earned={earned} />
      </section>

      {profile.publicTitles.length > 0 && (
        <section aria-labelledby="owner-public" className="flex flex-col gap-3">
          <H
            id="owner-public"
            className="font-display text-title-sm font-black"
          >
            Top 3 at a place
          </H>
          <ul className="flex flex-col gap-2">
            {profile.publicTitles.map((t) => (
              <li
                key={`${t.title}-${t.venue.placeId}`}
                className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-border-subtle bg-paper p-3"
              >
                <TitleBadge
                  id={t.title}
                  detail={`at ${t.venue.placeName}`}
                  info
                />
                <p className="text-label text-ink-soft">
                  There you&apos;re{" "}
                  <span className="font-bold text-ink">{t.alias}</span>, a
                  made-up name only you can link to you.
                </p>
                <Link
                  href={placeHref(t.venue)}
                  className={cn(
                    buttonStyles.quiet,
                    "ml-auto min-h-12 text-label",
                  )}
                >
                  See the place <ArrowRight className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.friendTitles.length > 0 && (
        <section
          aria-labelledby="owner-friends"
          className="flex flex-col gap-3"
        >
          <H
            id="owner-friends"
            className="font-display text-title-sm font-black"
          >
            Among friends
          </H>
          <ul className="flex flex-col gap-2">
            {profile.friendTitles.map((t) => (
              <li key={`${t.title}-${t.venue.placeId}`}>
                <TitleBadge
                  id={t.title}
                  detail={`at ${t.venue.placeName}`}
                  info
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.places.length > 0 && (
        <section aria-labelledby="owner-places" className="flex flex-col gap-3">
          <H
            id="owner-places"
            className="font-display text-title-sm font-black"
          >
            Your places
          </H>
          <p className="flex items-center gap-1.5 text-ink-soft">
            <Lock className="size-4 shrink-0" aria-hidden /> Only you see this.
            Your places are nobody else&apos;s business.
          </p>
          <ul className="flex flex-col gap-2">
            {profile.places.map((p) => (
              <li
                key={p.venue.placeId}
                className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-border-subtle bg-paper p-3"
              >
                <div className="min-w-48 flex-1">
                  <p className="font-bold">{p.venue.placeName}</p>
                  <p className="text-label text-ink-soft">
                    {visitsWord(p.visits)} counted.
                    {p.weeks >= 2 ? ` ${p.weeks} weeks here.` : ""}
                    {p.nextStage
                      ? ` ${TITLES[p.nextStage.stage].word} is ${visitsWord(p.nextStage.visitsAway)} away.`
                      : ""}
                  </p>
                </div>
                <TitleBadge
                  id={p.stage}
                  size="sm"
                  srDetail="Only you can see this."
                />
                <Link
                  href={placeHref(p.venue)}
                  className={cn(buttonStyles.quiet, "min-h-12 text-label")}
                  aria-label={`See ${p.venue.placeName}`}
                >
                  <MapPin className="size-4" aria-hidden /> See it
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ door */

/** Every screen ends at a door: one line from Larry and one real next step. */
export function Door({
  line,
  cta,
  alt,
  className,
}: {
  line: string;
  cta: { label: string; href: string };
  /** A second, quieter way out (the "stretch" beside a "repeat"). */
  alt?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      data-door
      className={cn(
        // Two ways out need the room: the line reads in full above them instead of in a thin column.
        "flex flex-col items-start gap-3 rounded-panel bg-ink p-4 text-paper",
        !alt && "sm:flex-row sm:items-center",
        className,
      )}
      data-surface="inverse"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <LarryAvatar size="md" decorative />
        <p>
          <span className="font-bold">{APP_NAME}: </span>
          {line}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkButton href={cta.href} variant="secondary">
          {cta.label}
        </LinkButton>
        {alt && (
          <Link
            href={alt.href}
            className={cn(
              buttonStyles.quiet,
              "text-paper not-aria-disabled:hover:bg-ink-hover",
            )}
          >
            {alt.label}
          </Link>
        )}
      </div>
    </div>
  );
}
