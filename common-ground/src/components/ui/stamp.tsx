import { cn } from "@/lib/utils";

/**
 * An earned mark, in the rubber-stamp language: a word, a Lucide icon and optional pips.
 * No gold, silver or bronze and no category colours: strength is shown by fill (outline, then solid)
 * and by pips, always next to the word, so nothing depends on colour.
 *
 * - variant "outline": paper ground, 2px ink edge, ink word. The default.
 * - variant "solid": ink ground, paper word. The stronger form of the same mark.
 * - variant "done": the one uppercase exception, a slightly tilted text-safe violet stamp for a finished
 *   step ("Done 30 Oct"). Pips are not used here.
 * - `pips` (filled) out of `pipsMax` (default 5) reads as "3 of 5" to screen readers unless `pipsLabel`
 *   says it better ("3 of 5 visits to Veteran").
 * - `detail` is a second easy-read line under the word ("at Café Condi", "2 visits away").
 * - `fresh`: just earned. The stamp is dealt in once when it first renders (a short lift and turn with
 *   --ease-deal over --dur-deal, through CSS @starting-style), then rests. Transform only, so the word is
 *   readable from the first frame, and the global reduced-motion clamp makes it a plain appearance.
 *   Announcing the gain ("New title: Regular at Café Condi.") is the caller's polite status line.
 */
export type StampVariant = "outline" | "solid" | "done";
export type StampSize = "sm" | "md";

export interface StampProps {
  variant?: StampVariant;
  size?: StampSize;
  /** A Lucide icon element (hidden from screen readers; the word carries the meaning). */
  icon?: React.ReactNode;
  pips?: number;
  pipsMax?: number;
  pipsLabel?: string;
  detail?: React.ReactNode;
  /** Just earned: dealt in once on first render (off under reduced motion). */
  fresh?: boolean;
  className?: string;
  children: React.ReactNode;
}

const VARIANT: Record<Exclude<StampVariant, "done">, string> = {
  outline: "border-2 border-ink bg-paper text-ink",
  solid: "border-2 border-ink bg-ink text-paper",
};

/** The deal for a just-earned stamp. `starting:` is the first frame, so nothing runs on later renders. */
const FRESH = "transition-transform duration-(--dur-deal) ease-deal starting:translate-y-2 starting:-rotate-6 starting:scale-90";

const SIZE: Record<StampSize, { box: string; word: string; icon: string }> = {
  sm: { box: "gap-1.5 px-2.5 py-1", word: "text-caption", icon: "[&>svg]:size-4" },
  md: { box: "gap-2 px-3 py-1.5", word: "text-label", icon: "[&>svg]:size-5" },
};

export function Stamp({
  variant = "outline",
  size = "md",
  icon,
  pips,
  pipsMax = 5,
  pipsLabel,
  detail,
  fresh = false,
  className,
  children,
}: StampProps) {
  if (variant === "done") {
    return (
      <span
        data-stamp="done"
        data-fresh={fresh || undefined}
        className={cn(
          "inline-flex -rotate-[4deg] items-center gap-1.5 rounded-tile border-(length:--border-frame) border-cat-games-ink px-2 py-0.5 font-display text-caption font-black uppercase text-cat-games-ink",
          fresh && FRESH,
          className,
        )}
      >
        {icon && (
          <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-4">
            {icon}
          </span>
        )}
        {children}
      </span>
    );
  }

  const s = SIZE[size];
  const filled = pips === undefined ? 0 : Math.max(0, Math.min(Math.round(pips), pipsMax));
  return (
    <span
      data-stamp={variant}
      data-fresh={fresh || undefined}
      className={cn("inline-flex max-w-full items-center rounded-badge font-bold", VARIANT[variant], s.box, fresh && FRESH, className)}
    >
      {icon && <span aria-hidden className={cn("inline-flex shrink-0", s.icon)}>{icon}</span>}
      <span className="flex min-w-0 flex-col">
        <span className={cn("leading-tight", s.word)}>{children}</span>
        {detail && (
          <span className={cn("text-caption font-bold leading-tight", variant === "solid" ? "text-paper-soft" : "text-ink-soft")}>
            {detail}
          </span>
        )}
      </span>
      {pips !== undefined && (
        <span className="ml-1 flex shrink-0 items-center gap-1" data-slot="pips">
          <span className="sr-only">{pipsLabel ?? `${filled} of ${pipsMax}`}</span>
          {Array.from({ length: pipsMax }, (_, i) => (
            <span
              key={i}
              aria-hidden
              data-pip={i < filled ? "on" : "off"}
              className={cn("size-2 rounded-full border-2 border-current", i < filled && "bg-current")}
            />
          ))}
        </span>
      )}
    </span>
  );
}
