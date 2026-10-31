"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Text fields and selects. 56px tall (--field-h; "sm" is 48px), paper ground, a 2px --border-control
 * edge (at least 3:1 on paper and table, WCAG 1.4.11) that turns full ink on focus, plus the global
 * focus ring. The caret is coral (globals.css). Every field has a real label; the hint and the error
 * are linked with `aria-describedby`, and an error sets `aria-invalid` and turns the edge danger red.
 * States: rest, hover (ink edge), focus (ink edge plus the ring), error, disabled, read-only.
 */
export type FieldSize = "sm" | "md";

// Disabled and read-only change tone (table ground, line edge, ink-soft words), never fade, so the
// value stays readable at 7.9:1. A disabled field leaves the tab order (the browser's rule); a
// read-only one stays focusable so its value can be selected and copied.
const CONTROL =
  "w-full min-w-0 rounded-mini border-2 border-border-control bg-paper px-4 text-body text-ink placeholder:text-ink-soft hover:border-ink focus:border-ink aria-invalid:border-danger disabled:cursor-not-allowed disabled:border-line disabled:bg-table disabled:text-ink-soft disabled:hover:border-line";
// Inputs only: a <select> always matches :read-only, so this never goes into CONTROL.
const READ_ONLY = "read-only:bg-table read-only:hover:border-border-control";

const SIZE: Record<FieldSize, string> = {
  md: "min-h-(--field-h)",
  sm: "min-h-12",
};

/** The control classes, for the rare call site that renders its own input (a search box inside a picker). */
export function fieldStyles(size: FieldSize = "md", className?: string) {
  return cn(CONTROL, SIZE[size], className);
}

interface ShellProps {
  /** Always printed unless `hideLabel`, which keeps it for screen readers only. */
  label: React.ReactNode;
  hideLabel?: boolean;
  /** A short easy-read line under the field. */
  hint?: React.ReactNode;
  /** Shown in danger text under the field. Positive first: say what to do, not what went wrong. */
  error?: React.ReactNode;
  size?: FieldSize;
  /** Classes for the wrapper (label, control and lines). */
  className?: string;
}

function useFieldIds(id: string | undefined, hint: React.ReactNode, error: React.ReactNode, describedBy?: string) {
  const auto = React.useId();
  const controlId = id ?? auto;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const ids = [describedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { controlId, hintId, errorId, describedBy: ids };
}

function Shell({
  controlId,
  label,
  hideLabel,
  hint,
  hintId,
  error,
  errorId,
  className,
  children,
}: ShellProps & { controlId: string; hintId?: string; errorId?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("text-label font-bold text-ink", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={hintId} className="text-label text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-label font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export interface FieldProps extends ShellProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "className"> {
  /** Classes for the input itself. */
  inputClassName?: string;
}

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hideLabel, hint, error, size = "md", className, inputClassName, id, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const ids = useFieldIds(id, hint, error, describedBy);
  return (
    <Shell {...{ label, hideLabel, hint, error, className }} controlId={ids.controlId} hintId={ids.hintId} errorId={ids.errorId}>
      <input
        ref={ref}
        id={ids.controlId}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={fieldStyles(size, cn(READ_ONLY, inputClassName))}
        {...rest}
      />
    </Shell>
  );
});

export interface SelectFieldProps extends ShellProps, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size" | "className"> {
  selectClassName?: string;
}

export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hideLabel, hint, error, size = "md", className, selectClassName, id, "aria-describedby": describedBy, children, ...rest },
  ref,
) {
  const ids = useFieldIds(id, hint, error, describedBy);
  return (
    <Shell {...{ label, hideLabel, hint, error, className }} controlId={ids.controlId} hintId={ids.hintId} errorId={ids.errorId}>
      <select
        ref={ref}
        id={ids.controlId}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        className={fieldStyles(size, cn("cursor-pointer pr-3", selectClassName))}
        {...rest}
      >
        {children}
      </select>
    </Shell>
  );
});
