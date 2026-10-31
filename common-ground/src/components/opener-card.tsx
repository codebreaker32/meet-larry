"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Smartphone, X } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { Poster } from "@/components/taste-card";
import type { TasteItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Show this" (R7): the opener full screen, with the shared thing's poster, so someone who finds
 * speaking hard can turn the phone round instead. Nothing is read aloud and nothing is sent. Opens
 * on one tap, closes on Done, the X or Escape, and gives focus back to the button.
 */
export function OpenerCard({
  line,
  item,
  label = "Show it instead",
  className,
}: {
  /** The opener: what they would otherwise say. */
  line: string;
  /** The shared thing to bring up, shown as its poster above the line. */
  item?: TasteItem;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const opener = React.useRef<HTMLButtonElement>(null);
  const done = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  const close = React.useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    done.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // Two buttons only: keep Tab inside the card.
      if (e.key === "Tab") {
        const root = document.getElementById(titleId)?.closest("[role=dialog]");
        const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>("button")] : [];
        if (!buttons.length) return;
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, titleId]);

  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)} className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label", className)}>
        <Smartphone className="size-5" aria-hidden /> {label}
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-0 z-50 flex flex-col bg-paper text-ink"
            data-testid="opener-card"
          >
            <div className="flex items-center justify-between gap-2 border-b-2 border-line px-4 py-2">
              <div>
                <h2 id={titleId} className="font-display text-title-sm font-black leading-tight">
                  Show this
                </h2>
                <p className="text-label text-ink-soft">Turn the phone round so they can read it.</p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className={cn(buttonStyles.quiet, "size-12 shrink-0 p-0")}>
                <X className="size-6" aria-hidden />
              </button>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-6 text-center">
              {item && <Poster item={item} className="h-56 w-40" sizes="180px" />}
              <p className="max-w-3xl font-display text-title-lg font-black leading-tight sm:text-step">{line}</p>
            </div>
            <div className="border-t-2 border-line p-4">
              <button ref={done} type="button" onClick={close} className={cn(buttonStyles.primary, "min-h-12 w-full")}>
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
