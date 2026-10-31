"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { tick } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * The one button. Built on the shared `buttonStyles` (primary ink pill, secondary paper pill, quiet text),
 * so a `<Button>` and a `<LinkButton>` always look the same.
 *
 * - size "md" is the 56px default (--button-h); "sm" is the 48px compact row size.
 * - `loading` and `disabled` both set `aria-disabled` and keep the button focusable, so focus never
 *   drops mid-conversation (DESIGN.md: never the `disabled` attribute while busy). Clicks are swallowed.
 * - `loading` swaps the icon for a spinner and sets `aria-busy`; the label stays, so the text never fades.
 * - Press feel comes from `buttonStyles` (globals.css `press`): it sinks while held, springs back on
 *   release, and never presses while inert.
 * - The primary variant plays a light haptic tick on a real press (lib/haptics: phones only, silent
 *   under reduced motion). `haptic={false}` opts out, e.g. for a primary that fires many times in a row.
 */
export type ButtonVariant = keyof typeof buttonStyles;
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: a spinner replaces the icon, the label stays, clicks are ignored. */
  loading?: boolean;
  /** Not available: stays focusable and readable, clicks are ignored. */
  disabled?: boolean;
  /** A Lucide icon element shown before the label (hidden from screen readers). */
  icon?: React.ReactNode;
  /** Primary only: a light haptic tick on press (default true). Other variants never vibrate. */
  haptic?: boolean;
}

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-(--button-h)",
  sm: "min-h-(--button-h-compact) px-4 max-sm:text-label",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    haptic = true,
    icon,
    type = "button",
    className,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  const inert = loading || disabled;
  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (inert) {
          e.preventDefault();
          return;
        }
        if (variant === "primary" && haptic) tick();
        onClick?.(e);
      }}
      className={cn(buttonStyles[variant], SIZE[size], inert && "cursor-not-allowed", className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-5 shrink-0 motion-safe:animate-spin" aria-hidden data-slot="spinner" />
      ) : icon ? (
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-5">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
