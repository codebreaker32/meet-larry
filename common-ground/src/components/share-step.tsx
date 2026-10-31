"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Share2 } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DraftStep } from "@/components/chat/end-panel";
import { encodeStepLink } from "@/lib/step-link";
import { useOrigin } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { QR_OPTIONS } from "@/lib/qr";

/** The saved step as a QR code and a link, so the other person keeps the plan on their own phone. */
export function ShareStep({
  steps,
  withPerson,
  ownerName,
  headingRef,
  onDone,
  title,
  note,
  cardLabel = "First Step",
}: {
  steps: DraftStep[];
  /** Who gets the copy; without one, the plan is shared with anyone the person chooses. */
  withPerson?: string;
  ownerName?: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
  title?: string;
  /** Shown under the step, e.g. "A plan, not a booking." */
  note?: React.ReactNode;
  /** The words on the card back under the QR code. */
  cardLabel?: string;
}) {
  const origin = useOrigin();
  const [index, setIndex] = React.useState(0);
  // The QR for one link: its image, or null when drawing it failed (the link button still works).
  const [qr, setQr] = React.useState<{ link: string; image: string | null } | null>(null);
  const [copy, setCopy] = React.useState<"idle" | "copied" | "failed">("idle");
  const step = steps[Math.min(index, steps.length - 1)];
  // The other person keeps the plan on their own phone, "with" the person who owns this one.
  const link = origin ? `${origin}/steps?add=${encodeStepLink({ kind: step.kind, text: step.text, withPerson: ownerName })}` : "";

  React.useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { ...QR_OPTIONS, width: 480 })
      .then((image) => setQr({ link, image }))
      .catch(() => setQr({ link, image: null }));
  }, [link]);
  const qrState = !link || qr?.link !== link ? "loading" : qr.image ? "ready" : "failed";
  const qrImage = qrState === "ready" ? qr!.image : null;

  const share = async () => {
    if (!link) return;
    setCopy("idle");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Our First Step", text: step.text, url: link });
        return;
      } catch (err) {
        // They closed the share sheet: nothing went wrong.
        if ((err as Error).name === "AbortError") return;
      }
    }
    // Clipboard needs a secure page and permission; only say "copied" when it really was.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        setCopy("copied");
        return;
      } catch {
        // Fall through to the manual copy.
      }
    }
    setCopy("failed");
  };

  return (
    <section
      aria-labelledby="share-title"
      className="max-h-(--share-max-h) overflow-y-auto rounded-panel border-2 border-ink bg-paper p-4 shadow-panel"
    >
      <h2 id="share-title" ref={headingRef} tabIndex={-1} className="font-display text-title-sm font-black focus:outline-none focus-visible:outline-none">
        {title ?? (withPerson ? `Saved. Now give ${withPerson} a copy` : "Saved. Share the plan")}
      </h2>
      <p className="text-ink-soft">
        {withPerson ? `${withPerson}, scan this with your phone camera to keep the plan.` : "Anyone you want to come along can scan this to keep the plan."}
      </p>

      {steps.length > 1 && (
        <div role="group" aria-label="Which step to share" className="mt-3 flex flex-wrap gap-2">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setCopy("idle");
              }}
              className={cn(
                "press press-soft min-h-12 rounded-full border-2 px-4 text-left font-bold",
                i === index ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper hover:border-border-control",
              )}
            >
              {s.text}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {/* The plan travels like a card: QR on an ink card back with the foil edge, as on /card. */}
        <div className="foil relative w-52 shrink-0 rounded-card bg-ink p-3 shadow-card">
          <div className="rounded-tile bg-paper p-2">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL from the qrcode library
              <img src={qrImage} alt={`QR code to save "${step.text}"`} className="aspect-square w-full" />
            ) : qrState === "failed" ? (
              // Drawing failed: say so in the square, and point to the link button beside it.
              <p className="grid aspect-square w-full place-items-center p-2 text-center text-label font-bold text-ink">
                The QR code didn&apos;t load. Send it as a link instead.
              </p>
            ) : (
              <div role="status" className="aspect-square w-full">
                <span className="sr-only">Making the QR code.</span>
                <Skeleton shape="block" className="size-full" />
              </div>
            )}
          </div>
          <p className="mt-2 text-center font-display text-caption font-black text-paper">{cardLabel}</p>
        </div>
        <div className="flex flex-col gap-2 self-stretch">
          <p className="font-bold leading-snug">{step.text}</p>
          {note}
          <button type="button" onClick={share} className={cn(buttonStyles.secondary, "min-h-12")}>
            <Share2 className="size-5" aria-hidden /> Send as a link
          </button>
          <p role="status" className={cn("text-label font-bold", copy === "failed" ? "text-danger" : "text-ink-soft")}>
            {copy === "copied" ? "Link copied." : copy === "failed" ? "Couldn't copy the link. Select it below and copy it." : ""}
          </p>
          {copy === "failed" && (
            <>
              <label htmlFor="step-link" className="sr-only">
                Link to the First Step
              </label>
              <input
                id="step-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-12 w-full min-w-0 rounded-tile border-2 border-ink bg-paper px-3 text-label"
              />
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onDone} className={cn(buttonStyles.primary, "min-h-12")}>
          Done
        </button>
      </div>
    </section>
  );
}
