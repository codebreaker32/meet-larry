import { CalendarCheck, Eye, EyeOff, Hash, Smartphone, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// "What we store", shown before the phone field and again at the start of sign-up (PRODUCT.md
// Accounts). Plain and complete: every field the account keeps, and who can see it.

const ROWS = [
  { Icon: Eye, title: "Your username", text: "A made-up name like QuietOtter42. It's the only thing other people see." },
  { Icon: EyeOff, title: "Your name", text: "So Larry knows what to call you. Strangers never see it." },
  { Icon: Smartphone, title: "Your phone number", text: "Only for signing in. Nobody sees it." },
  { Icon: CalendarCheck, title: "Your date of birth", text: "Only to check you're 18 or over. Nobody sees it." },
  {
    Icon: Hash,
    title: "Counts, not a diary",
    text: "Your taste card, your steps and how many times you've been to each place. No dates, no times, no map of where you went.",
  },
  { Icon: Trash2, title: "Yours to delete", text: "One tap removes all of it, any time." },
] as const;

export function WhatWeStore({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <section aria-labelledby="what-we-store" className={cn("rounded-panel border-2 border-ink bg-paper p-4 sm:p-5", className)}>
      <h2 id="what-we-store" className="font-display text-title-sm font-black">
        What we keep
      </h2>
      <p className="mt-1 text-ink-soft">We keep counts, not a diary.</p>
      <ul className={cn("mt-3 flex flex-col", compact ? "gap-2" : "gap-3")}>
        {ROWS.map(({ Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-table ring-2 ring-line">
              <Icon className="size-5" />
            </span>
            <p className="leading-snug">
              <span className="font-bold">{title}.</span> <span className={compact ? "text-ink-soft" : undefined}>{text}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
