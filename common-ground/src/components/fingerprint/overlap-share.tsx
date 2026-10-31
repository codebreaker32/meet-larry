"use client";

import * as React from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui";
import { type OverlapData, overlapShareText } from "@/lib/fingerprint";
import type { Domain } from "@/lib/types";
import { canvasBlob, drawOverlap, shareImage } from "./share-canvas";
import { deviceVenueNames } from "./use-fingerprint";

/**
 * "Our overlap" at the end of a pair session: one tap draws a picture of both first names and the
 * real things Qloo found for them, then opens the share sheet (or saves it). Places never go in.
 */
export function OverlapShare({ overlap, domains }: { overlap: OverlapData; domains?: Domain[] }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [image, setImage] = React.useState<{ url: string; alt: string } | null>(null);
  const [note, setNote] = React.useState("");

  React.useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image]);

  if (!overlap.shared.length && !overlap.bridges.length) return null;

  const make = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    setNote("");
    try {
      const { lines } = await drawOverlap(canvas, overlapShareText(overlap, deviceVenueNames()), { domains });
      const blob = await canvasBlob(canvas);
      if (!blob) throw new Error("no image");
      setImage({ url: URL.createObjectURL(blob), alt: lines.join(". ") });
      const how = await shareImage(blob, "larry-our-overlap.png", "Our overlap");
      setNote(how === "shared" ? "Shared. Nice." : how === "saved" ? "Saved to your phone." : how === "cancelled" ? "" : "Hmm, that didn't go through. Try again in a moment?");
    } catch {
      setNote("Hmm, that didn't go through. Try again in a moment?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="overlap-share" className="mt-3 flex flex-col items-start gap-2 rounded-tile bg-table p-3">
      <p className="font-bold">
        {overlap.names[0]} and {overlap.names[1]}, want a picture of your overlap?
      </p>
      <Button variant="secondary" size="sm" onClick={make} loading={busy} icon={<Share2 />}>
        Share our overlap
      </Button>
      <p role="status" aria-live="polite" className="font-bold empty:hidden">
        {note}
      </p>
      <canvas ref={canvasRef} data-testid="overlap-canvas" aria-hidden className="hidden" />
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL made on this device
        <img src={image.url} alt={image.alt} className="w-full max-w-60 rounded-card ring-2 ring-ink" />
      )}
    </div>
  );
}
