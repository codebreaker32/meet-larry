import { cn } from "@/lib/utils";

/**
 * Loading placeholders that match the final layout, so nothing jumps when content lands.
 *
 * - `shape`: "bar" (a line of text), "block" (a poster or tile), "circle" (an avatar) are still
 *   line-coloured fills with no shimmer and no pulse loop (DESIGN.md). "slot" is a dashed outline with no fill and no
 *   motion, for empty card slots and panels waiting on data (DESIGN.md: empty slots are dashed outlines).
 * - Every placeholder is hidden from screen readers. Wrap a set of them in `SkeletonGroup`, which says
 *   what is loading once, in a polite status region.
 * - Size it with classes at the call site (`h-4 w-2/3`).
 */
export type SkeletonShape = "bar" | "block" | "circle" | "slot";

const SHAPE: Record<SkeletonShape, string> = {
  bar: "h-4 rounded-full bg-line",
  block: "rounded-tile bg-line",
  circle: "aspect-square rounded-full bg-line",
  slot: "rounded-mini border-2 border-dashed border-line",
};

export function Skeleton({ shape = "bar", className }: { shape?: SkeletonShape; className?: string }) {
  return <span aria-hidden data-skeleton={shape} className={cn("block shrink-0", SHAPE[shape], className)} />;
}

export function SkeletonGroup({
  label,
  className,
  children,
}: {
  /** What is loading, read once: "Finding your common ground." */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
