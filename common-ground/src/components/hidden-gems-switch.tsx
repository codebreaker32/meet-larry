"use client";

import * as React from "react";
import { ChevronDown, Gem, SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui";
import { saveHiddenGems, useHiddenGems } from "@/lib/mood";
import { cn } from "@/lib/utils";

/**
 * "Hidden gems only" (glossary "Qloo signals"): leans Larry's Qloo lookups towards less popular picks
 * (Qloo filter.popularity.max on the server). Saved on this phone and sent with the person's own
 * requests. The change is announced in a status line, and a failed save flips back with a warm line.
 */
export function HiddenGemsSwitch({
  onChange,
  className,
  description = "Less-known picks that fit your taste.",
}: {
  /** Called after the switch is saved, so the page can look again. */
  onChange?: (on: boolean) => void;
  className?: string;
  description?: React.ReactNode;
}) {
  const on = useHiddenGems() ?? false;
  const [status, setStatus] = React.useState("");
  const [failed, setFailed] = React.useState(false);

  const change = (next: boolean) => {
    if (!saveHiddenGems(next)) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setStatus(next ? "Showing hidden gems only." : "Showing every pick again.");
    onChange?.(next);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Switch
        checked={on}
        onCheckedChange={change}
        label="Hidden gems only"
        icon={<Gem className="size-4" aria-hidden />}
        description={description}
      />
      {failed && (
        <p role="alert" className="text-label font-bold text-danger">
          Hmm, that didn&apos;t save. Try again in a moment?
        </p>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}

/**
 * The Hidden Gems switch tucked under "More options" (qloo-hooks-plan 3.3 / 6.4): closed by default,
 * so the conversation screen leads with Larry, not controls. The switch stays off by default and
 * announces its result in its status line. Use this on /larry instead of the bare switch.
 */
export function HiddenGemsMoreOptions({ description, onChange, className }: { description?: React.ReactNode; onChange?: (on: boolean) => void; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const on = useHiddenGems() ?? false;
  const id = React.useId();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="press press-flat -ml-2 flex min-h-12 items-center gap-1.5 self-start rounded-full px-2 text-label font-bold text-ink hover:bg-table"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        More options{on ? " (hidden gems on)" : ""}
        <ChevronDown className={cn("size-4 transition-transform duration-(--dur-quick)", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} hidden={!open}>
        <HiddenGemsSwitch description={description} onChange={onChange} />
      </div>
    </div>
  );
}
