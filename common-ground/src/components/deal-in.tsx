import type { CSSProperties } from "react";

/** Where each card starts before it settles (the same offsets the framer-motion version used). */
const START: Record<"left" | "right" | "below", CSSProperties> = {
  left: { "--deal-x": "-48px", "--deal-r": "-10deg" } as CSSProperties,
  right: { "--deal-x": "48px", "--deal-r": "10deg" } as CSSProperties,
  below: { "--deal-y": "56px", "--deal-r": "-4deg", "--deal-s": "0.9" } as CSSProperties,
};

/**
 * The deal: a card slides in from its side and settles, once. A CSS animation of transform only
 * (globals.css `.deal-in`, --dur-deal on the deal curve), so it needs no script: it plays from the
 * first paint of the static HTML, costs nothing at hydration, and the card is never hidden. Under
 * reduced motion it does not move at all (globals.css).
 */
export function DealIn({
  from,
  delay = 0,
  className,
  children,
}: {
  from: "left" | "right" | "below";
  /** Seconds. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const style = { ...START[from], "--deal-delay": `${delay}s` } as CSSProperties;
  return (
    <div className={className ? `deal-in ${className}` : "deal-in"} style={style}>
      {children}
    </div>
  );
}
