"use client";

import * as React from "react";
import { Blend, Download, MessageCircleQuestionMark, Plus, RotateCcw, Share2 } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { LarryAvatar, LarryMoment } from "@/components/larry-avatar";
import { Badge, Button } from "@/components/ui";
import {
  type FingerprintView,
  FINGERPRINT_MIN_PICKS,
  LESS_KNOWN_TOO_FEW,
  MAKE_YOUR_OWN_LABEL,
  askMeLine,
  askMePlain,
  fingerprintShareText,
  lessKnownLine,
  makeYourOwnLink,
} from "@/lib/fingerprint";
import { isAgeBucket } from "@/lib/mood";
import { readStored, useOrigin } from "@/lib/storage";
import type { Profile } from "@/lib/types";
import { isAdultBucket } from "@/lib/types/signals";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";
import { cn } from "@/lib/utils";
import { canvasBlob, drawFingerprint, shareImage } from "./share-canvas";
import { deviceVenueNames, useFingerprint } from "./use-fingerprint";

/**
 * The Taste Fingerprint (queue #2, qloo-hooks-plan 3.2): the full view on /me, or `compact` for the
 * card. Real Qloo popularity drives the count ("4 of your 6 picks are outside Qloo's top 10%"); the
 * Taste Twin becomes an "Ask me about ..." line someone can ask you. The compact view follows the
 * share strip list: picks, count and Ask-me line only, never "Your places", venues, titles or Glory.
 * Sharing waits for a real win (a saved plan or a check-in); the image's QR only opens "make your
 * own card", and under-18s (or an unknown age) get no QR at all.
 */
export function FingerprintPanel({
  profile,
  compact = false,
  headingLevel = 2,
  className,
}: {
  profile: Profile | null | undefined;
  compact?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const fp = useFingerprint(profile);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  if (!profile || !profile.items.length) return null;

  return (
    <section aria-labelledby="fingerprint-title" data-testid="fingerprint" className={cn("rounded-panel border-2 border-ink bg-paper p-4 sm:p-6", className)}>
      <Heading id="fingerprint-title" className="font-display text-title-sm font-black">
        Your Taste Fingerprint
      </Heading>
      <p className="mt-1 text-ink-soft">How your picks sit next to everyone&apos;s, from what real fans pick.</p>
      {profile.items.length < FINGERPRINT_MIN_PICKS && (
        <div className="mt-3 flex flex-col items-start gap-3">
          <p className="font-bold">Pick at least {FINGERPRINT_MIN_PICKS} favourites and Larry can read your card.</p>
          <AddPicks compact={compact} />
        </div>
      )}

      {profile.items.length < FINGERPRINT_MIN_PICKS ? null : fp.status === "loading" || fp.status === "idle" ? (
        <LarryMoment kind="thinking" layout="row" title="Larry is reading your card" className="mt-4" />
      ) : fp.status === "error" ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p role="alert" className="text-danger">
            {fp.message}
          </p>
          <Button variant="secondary" size="sm" icon={<RotateCcw />} onClick={fp.retry}>
            Try again
          </Button>
        </div>
      ) : (
        <Ready data={fp.data} profile={profile} compact={compact} />
      )}
    </section>
  );
}

function Ready({ data, profile, compact }: { data: FingerprintView; profile: Profile; compact: boolean }) {
  const count = lessKnownLine(data.lessKnown);
  const ask = askMeLine(data.twin);
  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <p className="text-lead font-bold leading-snug" data-testid="fingerprint-count">
          {count || LESS_KNOWN_TOO_FEW}
        </p>
        {!count && <AddPicks compact={compact} />}
      </div>

      {ask && (
        <div className="flex flex-col items-start gap-2 rounded-mini bg-table p-4" data-testid="fingerprint-ask">
          <Badge variant="paper" icon={<Blend />}>
            Taste Twin
          </Badge>
          <p className="flex items-start gap-2 font-display text-title-sm font-black leading-snug">
            <MessageCircleQuestionMark className="mt-1 size-6 shrink-0" aria-hidden />
            {ask}
          </p>
          <p className="text-label text-ink">{askMePlain(data.twin, data.twinBecause)}</p>
        </div>
      )}

      {data.caption && (
        <div className="flex items-start gap-3">
          <LarryAvatar size="md" decorative />
          <p className="leading-snug">
            <span className="block text-label font-bold text-ink-soft">Larry (AI pal)</span>
            {data.caption}
          </p>
        </div>
      )}

      {!compact && (
        <p className="text-label text-ink-soft">
          Outside the top 10% most popular means fewer people have found it yet. It is not a score. The Taste Twin is a real pick Larry found for you in another category.
        </p>
      )}

      <ShareFingerprint data={data} profile={profile} />
    </div>
  );
}

/** Opens card editing with the current picks kept (/create?edit=1), then comes back here. */
function AddPicks({ compact }: { compact: boolean }) {
  return (
    <LinkButton href={`/create?edit=1&next=${compact ? "/card" : "/me"}`} variant="secondary" className="min-h-12">
      <Plus className="size-5" aria-hidden /> Add more picks
    </LinkButton>
  );
}

/** A saved plan or a check-in on this phone: the "real win" that unlocks sharing. */
function hasWin(): boolean {
  const list = (key: string) => {
    const v = readStored<unknown>(key, null);
    return Array.isArray(v) && v.length > 0;
  };
  return list(STORAGE_KEYS.steps) || list(STORAGE_KEYS.placeCounters) || list(STORAGE_KEYS.checkinsV1);
}

/** 18+ by the age range saved on this phone. Unknown counts as under 18 (D17): no QR then. */
function adultHere(): boolean {
  const age = readStored<unknown>(STORAGE_KEYS.ageBucket, null);
  return isAgeBucket(age) && isAdultBucket(age);
}

function ShareFingerprint({ data, profile }: { data: FingerprintView; profile: Profile }) {
  const origin = useOrigin();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [image, setImage] = React.useState<{ url: string; alt: string } | null>(null);
  const [note, setNote] = React.useState("");
  // Read after mount: storage is on the device only.
  const [ready, setReady] = React.useState<{ win: boolean; adult: boolean } | null>(null);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setReady({ win: hasWin(), adult: adultHere() }));
    return () => cancelAnimationFrame(id);
  }, []);

  React.useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image]);

  if (!ready) return null;
  if (!ready.win) {
    return (
      <p className="border-t-2 border-line pt-4 text-label text-ink-soft" data-testid="fingerprint-share-later">
        Make a plan or check in somewhere first. Then you can share this picture.
      </p>
    );
  }

  const make = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    setNote("");
    try {
      const share = fingerprintShareText(data, profile.name, deviceVenueNames());
      const { lines } = await drawFingerprint(canvas, share, {
        // Only "make your own card": never /join or /pair, never anything about this card. No QR under 18.
        qrLink: origin && ready.adult ? makeYourOwnLink(origin) : undefined,
        qrLabel: MAKE_YOUR_OWN_LABEL,
        names: [data.twin?.entity.name, data.twinBecause].filter((n): n is string => !!n),
      });
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("no image");
      setImage({ url: URL.createObjectURL(blob), alt: lines.join(". ") });
      const how = await shareImage(blob, "larry-taste-fingerprint.png", "My Taste Fingerprint");
      setNote(how === "shared" ? "Shared. Nice." : how === "saved" ? "Downloaded. Share it anywhere." : how === "cancelled" ? "" : "Hmm, that didn't go through. Try again in a moment?");
    } catch {
      setNote("Hmm, that didn't go through. Try again in a moment?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3 border-t-2 border-line pt-4">
      <Button onClick={make} loading={busy} icon={image ? <Download /> : <Share2 />}>
        Share my Fingerprint
      </Button>
      <p className="text-label text-ink-soft">
        The picture shows your taste only. Never places, titles, Glory or dates.
        {ready.adult ? " Its QR only helps someone make their own card." : ""}
      </p>
      <p role="status" aria-live="polite" className="min-h-0 font-bold empty:hidden">
        {note}
      </p>
      {/* The drawing surface. Hidden: people see the finished picture below. */}
      <canvas ref={canvasRef} data-testid="fingerprint-canvas" aria-hidden className="hidden" />
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL made on this device; next/image can't take it
        <img src={image.url} alt={image.alt} className="w-full max-w-xs rounded-card shadow-card ring-2 ring-ink" />
      )}
    </div>
  );
}
