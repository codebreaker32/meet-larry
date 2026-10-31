"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pick exactly one of a few options (age range, the face scale): a `radiogroup` of 48px pills.
 *
 * - Keyboard follows the radio pattern: one Tab stop (the chosen option, or the first), arrow keys move
 *   and choose, Home and End jump to the ends.
 * - The chosen option is ink with paper text. Every option shows a word; an icon is optional and never alone.
 * - `layout` arranges the options: "wrap" is a wrapping row of pills, "even" is equal columns on one line.
 * - `size` "md" is an icon beside the word (48px tall); "lg" is a tall tile with the icon above the word.
 * - `error` prints a danger line under the group, linked with `aria-describedby`, and sets `aria-invalid`
 *   (say what to do: "Pick the range you are in.").
 * - `disabled` keeps every option focusable and readable but ignores choices: `aria-disabled` on the group
 *   and each option, the one busy style (table ground, line edge, ink-soft words), never a fade.
 */
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export type SegmentedLayout = "wrap" | "even";
export type SegmentedSize = "md" | "lg";

export interface SegmentedProps<T extends string | number> {
  /** The group's name, printed as a heading unless `hideLabel`. */
  label: React.ReactNode;
  hideLabel?: boolean;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  layout?: SegmentedLayout;
  size?: SegmentedSize;
  className?: string;
  /** Classes for the visible label. */
  labelClassName?: string;
  /** Shown in danger text under the options. Positive first: say what to do. */
  error?: React.ReactNode;
  /** Not available right now: options stay readable and focusable, choices are ignored. */
  disabled?: boolean;
}

const OPTION_SIZE: Record<SegmentedSize, string> = {
  md: "min-h-12 rounded-full px-4",
  lg: "min-h-18 flex-col gap-1 rounded-mini px-1.5 py-2 text-center",
};

export function Segmented<T extends string | number>({
  label,
  hideLabel,
  options,
  value,
  onChange,
  layout = "wrap",
  size = "md",
  className,
  labelClassName,
  error,
  disabled = false,
}: SegmentedProps<T>) {
  const labelId = React.useId();
  const errorId = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((o) => o.value === value);
  const tabStop = chosen >= 0 ? chosen : 0;

  const choose = (index: number) => {
    const next = (index + options.length) % options.length;
    // Disabled: arrow keys still move focus, so every option can be read, but nothing is chosen.
    if (!disabled) onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: options.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    choose(moves[e.key]);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p id={labelId} className={cn("text-label font-bold text-ink", hideLabel && "sr-only", labelClassName)}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        aria-disabled={disabled || undefined}
        className={cn("gap-2", layout === "even" ? "grid auto-cols-fr grid-flow-col" : "flex flex-wrap")}
      >
        {options.map((o, i) => {
          const on = i === chosen;
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={i === tabStop ? 0 : -1}
              aria-disabled={disabled || undefined}
              onClick={() => !disabled && onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                // Press feel (globals.css `press`): sinks while held, springs back; none while disabled.
                "press inline-flex min-w-0 items-center justify-center gap-2 border-2 text-label font-bold leading-tight",
                OPTION_SIZE[size],
                on ? "border-ink bg-ink text-paper" : "press-soft border-border-subtle bg-paper text-ink hover:border-ink",
                !on && !!error && "border-border-control",
                // Disabled keeps the choice visible: the chosen option goes ink-soft (paper words 9:1), the rest go table.
                "aria-disabled:cursor-not-allowed",
                on
                  ? "aria-disabled:border-ink-soft aria-disabled:bg-ink-soft"
                  : "aria-disabled:border-line aria-disabled:bg-table aria-disabled:text-ink-soft aria-disabled:hover:border-line",
              )}
            >
              {o.icon && (
                <span aria-hidden className={cn("inline-flex shrink-0", size === "lg" ? "[&>svg]:size-7" : "[&>svg]:size-4")}>
                  {o.icon}
                </span>
              )}
              <span className="min-w-0 break-words">{o.label}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-label font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
