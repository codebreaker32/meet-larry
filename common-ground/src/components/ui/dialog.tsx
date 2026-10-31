"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one dialog: a native `<dialog>` opened with `showModal()`, so the browser traps focus, makes the
 * page behind it inert, closes on Escape and returns focus to the trigger.
 *
 * - Controlled: `open` opens and closes it; `onOpenChange(false)` fires on Escape, the Close button and
 *   a tap on the scrim, so the caller's state never drifts from the element.
 * - A paper panel with a 2px ink border, panel radius and the --scrim behind it. `size` picks the width
 *   (--dialog-sm or --dialog-md); it scrolls inside 85dvh.
 * - The title is always printed (Anybody, title-sm) and names the dialog; `description` is linked with
 *   `aria-describedby`. The Close button is a 48px target labelled "Close"; `initialFocus` moves first
 *   focus to the safe choice instead.
 */
export type DialogSize = "sm" | "md";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** A Lucide icon element before the title. */
  icon?: React.ReactNode;
  /** One or two easy-read sentences under the title. */
  description?: React.ReactNode;
  size?: DialogSize;
  /** False keeps it open on a scrim tap and on Escape (a step that must be answered). Default true. */
  dismissible?: boolean;
  /** Fires after the dialog has closed, however it closed. */
  onClosed?: () => void;
  /** The control to focus on open ("Stay" in a leave check). Default: the browser's first focusable, Close. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  children?: React.ReactNode;
}

const WIDTH: Record<DialogSize, string> = {
  sm: "max-w-dialog-sm",
  md: "max-w-dialog-md",
};

export function Dialog({
  open,
  onOpenChange,
  title,
  icon,
  description,
  size = "md",
  dismissible = true,
  onClosed,
  initialFocus,
  className,
  children,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      initialFocus?.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocus]);

  const requestClose = () => {
    if (dismissible) onOpenChange(false);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Escape fires "cancel" first: let the caller decide, then the effect closes the element.
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      // Chromium's CloseWatcher lets a second Escape skip "cancel" and close anyway: stop it at keydown,
      // and if a step that must be finished still closes, open it again.
      onKeyDown={(e) => {
        if (e.key === "Escape" && !dismissible) e.preventDefault();
      }}
      onClose={() => {
        if (open && !dismissible) {
          ref.current?.showModal();
          return;
        }
        if (open) onOpenChange(false);
        onClosed?.();
      }}
      // A tap on the scrim lands on the dialog element itself, never on the panel inside it.
      onClick={(e) => e.target === e.currentTarget && requestClose()}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-h-(--dialog-max-h) overflow-y-auto rounded-panel border-2 border-ink bg-paper p-0 text-ink shadow-panel backdrop:bg-scrim",
        WIDTH[size],
        className,
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center gap-2 font-display text-title-sm font-black leading-tight">
            {icon && (
              <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-6">
                {icon}
              </span>
            )}
            {title}
          </h2>
          {dismissible && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="-mt-1 -mr-2 grid size-12 shrink-0 place-items-center rounded-full text-ink hover:bg-table"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        {description && (
          <p id={descId} className="mt-2 text-body text-ink">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </dialog>
  );
}
