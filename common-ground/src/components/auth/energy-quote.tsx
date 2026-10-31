"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// One short, warm line on the sign-in screen, different on every visit. Picked on the device after
// mount, so the server render never disagrees with the client.
export const ENERGY_QUOTES = [
  "Someone out there loves your favourite film too.",
  "One hello can change a whole week.",
  "Your people are closer than you think.",
  "Small steps out the door still count.",
  "The best plans start with something you both love.",
  "Today is a good day to meet someone new.",
  "Your taste is a great conversation starter.",
  "Real friends are made one shared thing at a time.",
  "A calm café and one good question. That's enough.",
  "You don't need the perfect words. Just a start.",
  "Somewhere nearby, a game night has a free seat.",
  "Go out, come back with a story.",
] as const;

const noSubscribe = () => () => {};

export function EnergyQuote({ className }: { className?: string }) {
  const index = React.useSyncExternalStore(
    noSubscribe,
    () => {
      const w = window as unknown as { __larryQuote?: number };
      w.__larryQuote ??= Math.floor(Math.random() * ENERGY_QUOTES.length);
      return w.__larryQuote;
    },
    () => -1,
  );
  return (
    <p className={cn("min-h-[3.5rem] max-w-md font-display text-title-sm font-black leading-tight text-ink", className)} aria-live="off">
      {index >= 0 ? ENERGY_QUOTES[index] : " "}
    </p>
  );
}
