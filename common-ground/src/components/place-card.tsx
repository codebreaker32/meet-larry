"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { ChevronRight, Clock, Coffee, Hand, Leaf, MapPin, Users } from "lucide-react";
import type { PlaceCard as PlaceCardData, PlaceFit, PlaceVibe } from "@/lib/contracts";
import { VIBE_WORD, vibeOf } from "@/lib/suggest-steps";
import type { Place } from "@/lib/types";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Who a fit line is about: a pair seat ("a"/"b") or a room member id, with their seat colour. */
export type FitPeople = Record<string, { name: string; color: string }>;

export const VIBE_ICON: Record<PlaceVibe, typeof Leaf> = { calm: Leaf, cosy: Coffee, lively: Users };

/** Only Qloo's image host is allowed through next/image (next.config.ts). */
const qlooImage = (url: string | undefined) => (url && url.startsWith("https://images.qloo.com/i/") ? url : undefined);

const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

/** "maybe, it can get busy" / "probably not, it's loud": the likelihood is always in the words, never colour alone. */
export function fitLine(fit: PlaceFit): string {
  const why = fit.why.trim().replace(/[.]$/, "");
  if (fit.likely === "likes") return why;
  const lead = fit.likely === "maybe" ? "maybe" : "probably not";
  return new RegExp(`^${lead}\\b`, "i").test(why) ? why : `${lead}, ${why}`;
}

/**
 * The vibe as a chip: icon and word (Calm, Cosy, Lively). It is a link: tapping it asks Larry for
 * another place with the same vibe. A hit area of 48px (PRODUCT.md) sits around the small chip.
 */
export function VibeChip({ vibe, className, link = true }: { vibe: PlaceVibe; className?: string; link?: boolean }) {
  const Icon = VIBE_ICON[vibe];
  const word = VIBE_WORD[vibe];
  const look = cn(
    "inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-0.5 text-caption font-bold text-ink ring-2 ring-ink",
    className,
  );
  if (!link) {
    return (
      <span className={look}>
        <Icon className="size-3.5" aria-hidden /> {word}
      </span>
    );
  }
  return (
    <Link
      href={`/larry?ask=place&vibe=${vibe}`}
      aria-label={`${word}. Find more ${word.toLowerCase()} places with ${APP_NAME}`}
      className={cn(
        look,
        "relative hover:bg-table before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']",
      )}
    >
      <Icon className="size-3.5" aria-hidden /> {word}
      <ChevronRight className="-mr-1 size-3.5" aria-hidden />
    </Link>
  );
}

/**
 * A real place as a venue card: Qloo's cover photo, the name, how far, its vibe (Calm, Cosy or
 * Lively) and plain tags, opening hours, and one fit line per person ("Sam: board games, and it's
 * quiet"). Places are not a taste domain, so the frame is ink. `action` is a button such as
 * "Plan this".
 */
export function PlaceCard({
  place,
  people,
  action,
  size = "md",
  meet = false,
  className,
}: {
  place: Place | PlaceCardData;
  /** Names and seat colours for the fit lines; fits for anyone not listed are left out. */
  people?: FitPeople;
  action?: React.ReactNode;
  /** "lg": the photo sits on top (the Plan Ticket); "md": beside the words (lists). */
  size?: "md" | "lg";
  /** Show the way into Open to meet at this place (mutual, signed-in members 18+ only, only while you are there). */
  meet?: boolean;
  className?: string;
}) {
  const card = place as Partial<PlaceCardData> & Place;
  // Open to meet is for signed-in members (accounts are 18+): nobody else is offered the way in.
  const signedIn = useAuth().status === "signed-in";
  const showMeet = meet && signedIn;
  // A photo that fails to load falls back to the solid Places tile, never a broken image.
  const [failed, setFailed] = React.useState<string | null>(null);
  const photo = qlooImage(card.image);
  const image = photo && photo !== failed ? photo : undefined;
  const vibe = vibeOf(card);
  const vibeWord = VIBE_WORD[vibe].toLowerCase();
  const VibeIcon = VIBE_ICON[vibe];
  // Plain tags from Qloo, without repeating the vibe chip.
  const tags = [...new Set(card.tags.map((t) => sentenceCase(t.trim())).filter((t) => t && t.toLowerCase() !== vibeWord))].slice(0, 3);
  const fits = (card.fits ?? []).filter((f) => people?.[f.who] && f.why.trim());
  const lg = size === "lg";

  return (
    <article
      className={cn(
        "flex gap-3 rounded-mini border-2 border-ink bg-paper p-2.5 shadow-mini",
        lg ? "flex-col" : "flex-row",
        className,
      )}
    >
      <div
        className={cn("relative shrink-0 overflow-hidden rounded-tile bg-table", lg ? (image ? "h-40 w-full sm:h-48" : "h-14 w-full") : "w-24 self-stretch sm:w-28")}
        style={lg ? undefined : { minHeight: "6rem" }}
      >
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes={lg ? "(min-width: 640px) 34rem, 100vw" : "112px"}
            className="object-cover"
            onError={() => setFailed(image)}
          />
        ) : (
          // No photo from Qloo: a solid Places tile (travel sky blue + the vibe icon), never an empty frame.
          <span aria-hidden data-no-photo className="absolute inset-0 grid place-items-center bg-cat-travel">
            <span className="grid size-10 place-items-center rounded-full bg-paper ring-2 ring-ink">
              <VibeIcon className="size-5 text-ink" />
            </span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <h3 className={cn("font-display font-black leading-tight", lg ? "text-title-sm" : "text-body")}>{card.name}</h3>
        <p className="flex flex-wrap gap-1.5">
          <VibeChip vibe={vibe} />
          <span className="sr-only">.</span>
          {card.distanceKm != null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-table px-2.5 py-0.5 text-caption font-bold text-ink">
              <MapPin className="size-3.5" aria-hidden /> {card.distanceKm} km away
              <span className="sr-only">.</span>
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-table px-2.5 py-0.5 text-caption font-bold text-ink">
              {t}
              <span className="sr-only">.</span>
            </span>
          ))}
        </p>
        {card.hours && (
          <p className="flex items-start gap-1.5 text-label leading-snug text-ink">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="sr-only">Opening hours: </span>
              {card.hours}
            </span>
          </p>
        )}
        {fits.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {fits.map((f) => (
              <li key={f.who} className="flex items-start gap-2 text-label leading-snug text-ink">
                <span aria-hidden className="mt-[0.3rem] h-3 w-1.5 shrink-0 rounded-full" style={{ background: people![f.who].color }} />
                <span>
                  <span className="font-bold">{people![f.who].name}:</span> {fitLine(f)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          card.reason && <p className="text-label leading-snug text-ink">{card.reason}</p>
        )}
        {/* Qloo's evidence, worded as what it is, behind a small "Why?" (never the main line). */}
        {card.qlooWhy && (
          <details className="group text-label text-ink">
            <summary className="inline-flex min-h-12 cursor-pointer list-none items-center gap-1 rounded-full font-bold underline decoration-2 underline-offset-4 [&::-webkit-details-marker]:hidden">
              Why this place?
            </summary>
            <p className="pb-1 leading-snug text-ink-soft">{card.qlooWhy}</p>
          </details>
        )}
        {(action || showMeet) && (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
            {action}
            {showMeet && (
              <Link
                href={`/meet/${encodeURIComponent(place.id)}`}
                className="inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-label font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-table"
              >
                <Hand className="size-4" aria-hidden /> Open to meet here
              </Link>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
