import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// One look for "can't press this right now", whether the button is `disabled` or busy with
// `aria-disabled` (DESIGN.md: busy buttons stay focusable, so mid-conversation they use
// aria-disabled, never the disabled attribute). Disabled never fades text (No Opacity Text Rule):
// it becomes a paper pill with a line border and ink-soft text, 9:1, and no shadow. Hover and press
// are switched off while aria-disabled, so the pill never flashes ink. Callers still guard their
// click handler: aria-disabled does not block clicks on its own.
// Press feel (globals.css `press`): every look sits on a thin edge, lifts 1px on hover, sinks onto the
// table while held and springs back on release; never while busy or disabled. Primary sits on a soft
// ink edge, secondary on a hard ink edge (a thick card), quiet has no edge and sinks 1px.
// Class strings stay literal so Tailwind's scanner finds them.
const base = cn(
  "press inline-flex min-h-(--button-h) items-center justify-center gap-2 rounded-full px-6 text-body font-bold",
  "disabled:pointer-events-none disabled:border-2 disabled:border-line disabled:bg-paper disabled:text-ink-soft disabled:shadow-none",
  "aria-disabled:cursor-not-allowed aria-disabled:border-2 aria-disabled:border-line aria-disabled:bg-paper aria-disabled:text-ink-soft aria-disabled:shadow-none aria-busy:cursor-progress",
);

export const buttonStyles = {
  primary: cn(base, "bg-ink text-paper not-aria-disabled:hover:bg-ink-hover"),
  secondary: cn(base, "press-hard border-2 border-ink bg-paper text-ink not-aria-disabled:hover:bg-table"),
  quiet: cn(base, "press-flat min-h-(--button-h-compact) px-4 text-ink not-aria-disabled:hover:bg-paper"),
};

/**
 * The loading slot for any `buttonStyles` button: put it before the label and set
 * `aria-disabled` and `aria-busy` on the button. The label stays, so the button keeps its name for
 * screen readers and its width; the spinner only turns when motion is allowed.
 *
 *   <button aria-disabled={busy} aria-busy={busy} className={buttonStyles.primary}>
 *     {busy && <ButtonSpinner />} Deal the cards
 *   </button>
 */
export function ButtonSpinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-5 shrink-0 motion-safe:animate-spin", className)} />;
}

export function LinkButton({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof buttonStyles;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(buttonStyles[variant], className)}>
      {children}
    </Link>
  );
}
