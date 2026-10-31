import { cn } from "@/lib/utils";

/**
 * A small, non-interactive marker: "Best fit", "Hidden gem", "Big near you", "Practice character".
 * Never a target and never colour alone: always a word, optionally with a Lucide icon.
 *
 * - variant "ink": ink pill with paper text, for the one strongest marker on a card ("Best fit").
 * - variant "paper": paper pill with a 2px ink ring, for neutral signals.
 * - variant "outline": no fill, a 2px --border-subtle ring and ink-soft text, for quiet meta.
 * - size "sm" sits inline in a caption row; "md" is 32px tall for markers on their own line.
 */
export type BadgeVariant = "ink" | "paper" | "outline";
export type BadgeSize = "sm" | "md";

const VARIANT: Record<BadgeVariant, string> = {
  ink: "bg-ink text-paper",
  paper: "bg-paper text-ink ring-2 ring-ink",
  outline: "text-ink-soft ring-2 ring-border-subtle",
};

const SIZE: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5",
  md: "min-h-8 px-3 py-1",
};

export function Badge({
  variant = "ink",
  size = "sm",
  icon,
  className,
  children,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** A Lucide icon element before the word (hidden from screen readers). */
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full text-caption font-bold leading-tight",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon && (
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-3.5">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
