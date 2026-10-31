"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Choice and action chips: always 48px pills (--chip-h) with a Lucide icon and a word.
 *
 * - Pass `pressed` for a choice chip (`aria-pressed`): pressed is ink with paper text. Leave it out
 *   for an action chip (a plain button).
 * - `variant` picks the resting ground: "paper" on the table, "table" inside a paper panel.
 * - Resting edge is --border-subtle (chips are identified by their words, not their edge); hover is ink.
 * - `busy` sets `aria-disabled`: a tone change (line edge, ink-soft text), never a fade. Clicks are ignored.
 * - Press feel (globals.css `press`): a thin edge at rest (subtle, ink-tinted once pressed), a sink
 *   while held and a spring back on release; none while busy.
 */
export type ChipVariant = "paper" | "table";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
  variant?: ChipVariant;
  icon?: React.ReactNode;
  busy?: boolean;
}

const GROUND: Record<ChipVariant, string> = {
  paper: "bg-paper",
  table: "bg-table",
};

export function chipStyles({
  pressed = false,
  variant = "paper",
  className,
}: { pressed?: boolean; variant?: ChipVariant; className?: string } = {}) {
  return cn(
    "press inline-flex min-h-(--chip-h) max-w-full items-center justify-center gap-2 rounded-full border-2 px-4 text-label font-bold leading-tight",
    pressed ? "border-ink bg-ink text-paper" : cn("press-soft border-border-subtle text-ink hover:border-ink", GROUND[variant]),
    "aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:bg-table aria-disabled:text-ink-soft",
    className,
  );
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { pressed, variant, icon, busy = false, type = "button", className, onClick, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={chipStyles({ pressed, variant, className })}
      {...rest}
    >
      {icon && (
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
});
