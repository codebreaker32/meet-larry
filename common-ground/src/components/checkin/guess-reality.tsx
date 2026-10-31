"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { FaceMark, FaceScale, faceWord, FACES, type FaceValue } from "@/components/ui";
import { buttonStyles } from "@/components/link-button";
import { cn } from "@/lib/utils";

export type Glad = "yes" | "meh" | "no";

const GLAD: { value: Glad; label: string; Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }[] = [
  { value: "yes", label: "Yes", Icon: ThumbsUp },
  { value: "meh", label: "Meh", Icon: FACES[2].Icon },
  { value: "no", label: "No", Icon: ThumbsDown },
];

/**
 * Guess vs Reality, the after half (spec 6): "How did it go?" on the five faces, then "Glad you went?".
 * Both optional. Private, on this phone only.
 */
export function RealityPicker({
  reality,
  glad,
  onReality,
  onGlad,
}: {
  reality: FaceValue | null;
  glad: Glad | null;
  onReality: (v: FaceValue) => void;
  onGlad: (g: Glad) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <FaceScale label="How did it go?" value={reality} onChange={onReality} labelClassName="font-display text-title-sm font-black" />
      <div>
        <h3 id="glad-title" className="font-bold">
          Glad you went?
        </h3>
        <div role="group" aria-labelledby="glad-title" className="mt-2 flex flex-wrap gap-2">
          {GLAD.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={glad === value}
              onClick={() => onGlad(value)}
              className={cn(buttonStyles.secondary, "min-h-12 px-5", glad === value && "border-ink bg-ink text-paper hover:bg-ink-hover")}
            >
              <Icon className="size-5" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The reveal. Numbers and faces only when reality met or beat the guess ("You guessed Not great. It
 * was Good."); a worse visit gets no comparison at all. Nothing shows without a guess.
 */
export function GuessReveal({ guess, reality }: { guess?: FaceValue; reality: FaceValue | null }) {
  if (!guess || !reality || reality < guess) return null;
  const sentence = `You guessed ${faceWord(guess)}. It was ${faceWord(reality)}.`;
  return (
    <div className="mt-4">
      <p role="status" className="sr-only">
        {sentence}
      </p>
      <div aria-hidden className="grid grid-cols-2 gap-3">
        <div className="rounded-mini border-2 border-ink bg-paper p-3 text-center">
          <p className="text-label font-bold text-ink-soft">Your guess</p>
          <FaceMark value={guess} className="mt-1" />
        </div>
        <div className="rounded-mini border-2 border-ink bg-paper p-3 text-center transition-transform duration-(--dur-deal) ease-deal starting:translate-y-2 starting:-rotate-3">
          <p className="text-label font-bold text-ink-soft">What happened</p>
          <FaceMark value={reality} className="mt-1" />
        </div>
      </div>
    </div>
  );
}

/** Reality as a ladder feeling: Good or Great is easy, OK is OK, the rest was hard. */
export const feelingFromReality = (r: FaceValue | null): "good" | "okay" | "hard" | null => (r === null ? null : r >= 4 ? "good" : r === 3 ? "okay" : "hard");
