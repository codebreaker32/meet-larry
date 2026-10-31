"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Chip } from "@/components/ui";
import { MOOD_INFO, saveMood, useMood } from "@/lib/mood";
import { MOODS, type Mood } from "@/lib/types/signals";
import { cn } from "@/lib/utils";

/**
 * One-tap mood (glossary "Moods"): Chill, Social, Curious, Low energy, Hype. Optional, changeable any
 * time, and tapping the chosen mood again clears it. Saved on this phone only and sent with the
 * person's own requests (never shown to anyone else).
 *
 * - `compact`: a single pill that says today's mood and opens the row on tap (chat headers).
 * - The change is announced in a polite status line, and the meaning line of the chosen mood shows.
 */
export function MoodPicker({
  compact = false,
  onChange,
  className,
  label = "How are you feeling today?",
}: {
  compact?: boolean;
  /** Called after the mood is saved (pages may re-ask Larry). */
  onChange?: (mood: Mood | null) => void;
  className?: string;
  label?: string;
}) {
  const mood = useMood();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const headingId = React.useId();
  const rowId = React.useId();

  const pick = (m: Mood) => {
    const next = mood === m ? null : m;
    if (!saveMood(next)) {
      setStatus("Hmm, that didn't save. Try again in a moment?");
      return;
    }
    setStatus(next ? `Mood: ${MOOD_INFO[next].label}. ${MOOD_INFO[next].meaning}` : "Mood cleared.");
    if (compact) setOpen(false);
    onChange?.(next);
  };

  const row = (
    <div id={rowId} role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
      {MOODS.map((m) => {
        const Icon = MOOD_INFO[m].icon;
        return (
          <Chip key={m} pressed={mood === m} onClick={() => pick(m)} icon={<Icon />}>
            {MOOD_INFO[m].label}
          </Chip>
        );
      })}
    </div>
  );

  const current = mood ? MOOD_INFO[mood] : null;
  const CurrentIcon = current?.icon;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {compact ? (
        <>
          <span id={headingId} className="sr-only">
            {label}
          </span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={rowId}
            onClick={() => setOpen((v) => !v)}
            className="press press-soft inline-flex min-h-12 w-fit max-w-full items-center gap-2 rounded-full border-2 border-border-subtle bg-paper px-4 text-label font-bold text-ink hover:border-ink"
          >
            {CurrentIcon && <CurrentIcon className="size-4 shrink-0" aria-hidden />}
            {current ? `Mood: ${current.label}` : "Pick a mood"}
            <ChevronDown className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
          </button>
          {open && row}
        </>
      ) : (
        <>
          <p id={headingId} className="text-label font-bold text-ink">
            {label}
          </p>
          {row}
          <p className="min-h-6 text-label text-ink-soft">{current ? current.meaning : "Optional. Change it any time."}</p>
        </>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
