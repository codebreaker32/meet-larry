"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { GLORY } from "@/lib/titles";
import { cn } from "@/lib/utils";

/**
 * Glory (spec 2): "312 Glory" with the Sun icon. A quiet lifetime total from real visits. Never a
 * progress bar, never a rank, never shown to strangers. It only ever counts up: one count-up from
 * the old value to the new one when it grows (none under reduced motion), and never animates down.
 *
 * - size "hero": ink panel, big numeral (the check-in result, the owner profile).
 * - size "inline": one line (headers).
 * - size "chip": a paper pill.
 * - `gain`: a separate line beside the total, tied to one named action ("+10 Glory for your visit to
 *   Café Condi."), announced once in a polite status region.
 * - Zero is never shown as "0 Glory": the owner sees how the first Glory comes instead.
 */
export function GloryCount({
  value,
  size = "inline",
  gain,
  className,
}: {
  value: number;
  size?: "hero" | "inline" | "chip";
  gain?: { amount: number; reason: string };
  className?: string;
}) {
  const shown = useCountUp(Math.max(0, Math.floor(value)));
  const Icon = GLORY.Icon;
  const total = Math.max(0, Math.floor(value));
  const hero = size === "hero";

  if (total === 0 && !gain) {
    return <p className={cn("text-ink-soft", className)}>Your first Glory comes from your first real visit.</p>;
  }

  const number = (
    <span className={cn("inline-flex items-center gap-2", size === "chip" && "gap-1.5")}>
      <Icon aria-hidden className={cn(hero ? "size-8" : size === "chip" ? "size-4" : "size-5", "shrink-0")} />
      {/* The count-up is decoration; the final value is in the sr-only text. */}
      <span aria-hidden className={cn("font-display font-black tabular-nums", hero ? "text-step leading-none" : size === "chip" ? "text-label" : "text-title-sm")}>
        {shown}
      </span>
      <span aria-hidden className={cn("font-display font-black", hero ? "text-title-sm" : size === "chip" ? "text-label" : "text-title-sm")}>
        {GLORY.word}
      </span>
      <span className="sr-only">
        {total} {GLORY.word}.
      </span>
    </span>
  );

  return (
    <div
      className={cn(
        hero && "rounded-panel bg-ink p-5 text-paper",
        size === "chip" && "inline-flex min-h-12 items-center rounded-full border-2 border-ink bg-paper px-4 text-ink",
        size === "inline" && "text-ink",
        className,
      )}
    >
      <p>{number}</p>
      {gain && gain.amount > 0 && (
        <p role="status" className={cn("mt-2 font-bold", hero ? "text-paper-soft" : "text-ink-soft")}>
          +{gain.amount} {GLORY.word} {gain.reason}
        </p>
      )}
      {hero && <p className="mt-1 text-label text-paper-soft">{GLORY.meaning}</p>}
    </div>
  );
}

/** Counts up from the last shown value to `target` once; jumps straight there under reduced motion or when it would go down. */
function useCountUp(target: number): number {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(target);
  const from = React.useRef(target);
  React.useEffect(() => {
    const start = from.current;
    from.current = target;
    if (reduce || target <= start) {
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const ms = 600; // --dur-deal
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return Math.max(0, shown);
}
