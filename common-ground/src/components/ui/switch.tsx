"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An on/off setting ("Hidden gems only", "Show my check-ins to friends"): a 48px pill with
 * `role="switch"` and `aria-checked`. The words are the label, a track and knob show the state,
 * and the state word ("On" or "Off") is printed too, so colour and position are never the only cue.
 * On, the pill turns ink with paper text.
 *
 * - `busy` (the change is being saved) and `disabled` (not available here) both set `aria-disabled`,
 *   keep the pill focusable and ignore taps. The pill turns to the one busy style (table ground, line
 *   edge, ink-soft words), a tone change, never a fade. `busy` also sets `aria-busy`.
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked" | "children"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The setting, in words. */
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** An easy-read line linked with `aria-describedby`, shown under the pill. */
  description?: React.ReactNode;
  /** Words for the two states. Default "On" and "Off". */
  stateWords?: { on: string; off: string };
  /** Classes for the wrapper when a description is shown. */
  wrapperClassName?: string;
  /** The change is being saved: taps are ignored until it lands. */
  busy?: boolean;
  /** Not available right now: stays focusable and readable, taps are ignored. */
  disabled?: boolean;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onCheckedChange,
    label,
    icon,
    description,
    stateWords = { on: "On", off: "Off" },
    className,
    wrapperClassName,
    id,
    onClick,
    "aria-describedby": describedBy,
    busy = false,
    disabled = false,
    ...rest
  },
  ref,
) {
  const inert = busy || disabled;
  const auto = React.useId();
  const switchId = id ?? auto;
  const descId = description ? `${switchId}-desc` : undefined;
  const pill = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={[describedBy, descId].filter(Boolean).join(" ") || undefined}
      aria-disabled={inert || undefined}
      aria-busy={busy || undefined}
      onClick={(e) => {
        if (inert) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        // Press feel (globals.css `press`): a hard ink edge when off (a paper card), soft when on;
        // sinks while held, springs back; none while busy or disabled.
        "press inline-flex min-h-(--chip-h) max-w-full items-center gap-3 rounded-full border-2 border-ink px-4 text-label font-bold leading-tight",
        checked ? "bg-ink text-paper" : "press-hard bg-paper text-ink hover:bg-table",
        "aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:bg-table aria-disabled:text-ink-soft aria-disabled:hover:bg-table aria-busy:cursor-progress",
        className,
      )}
      {...rest}
    >
      {icon && (
        <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 text-left">{label}</span>
      <span aria-hidden className="ml-auto flex shrink-0 items-center gap-2">
        <span
          data-slot="track"
          className={cn(
            "relative h-6 w-10 rounded-full border-2 transition-colors duration-(--dur-quick)",
            checked ? "border-paper bg-paper" : "border-ink bg-table",
            inert && "border-ink-soft bg-paper",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-4 rounded-full bg-ink transition-transform duration-(--dur-quick) ease-deal",
              checked && "translate-x-4",
              inert && "bg-ink-soft",
            )}
          />
        </span>
        <span className="min-w-[3ch]">{checked ? stateWords.on : stateWords.off}</span>
      </span>
    </button>
  );
  if (!description) return pill;
  return (
    <div className={cn("flex flex-col items-start gap-1.5", wrapperClassName)}>
      {pill}
      <p id={descId} className="text-label text-ink-soft">
        {description}
      </p>
    </div>
  );
});
