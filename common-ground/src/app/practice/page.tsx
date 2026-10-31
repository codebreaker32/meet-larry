"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { PERSONAS, type PracticeLevel } from "@/lib/demo";
import { useProfile } from "@/lib/storage";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

// One neutral pill style for every level: words and a small meter carry the difficulty, never a domain colour.
const LEVEL: Record<PracticeLevel, { label: string; dots: number }> = {
  Easy: { label: "Easy", dots: 1 },
  Medium: { label: "Medium", dots: 2 },
  Shy: { label: "Harder: shy", dots: 3 },
};

function LevelPill({ level }: { level: PracticeLevel }) {
  const { label, dots } = LEVEL[level];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-paper px-3 py-1 text-label font-bold text-ink ring-2 ring-border-subtle">
      <span aria-hidden className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("size-2 rounded-full", i <= dots ? "bg-ink" : "ring-[1.5px] ring-inset ring-ink")} />
        ))}
      </span>
      {label}
    </span>
  );
}

export default function PracticePage() {
  const mine = useProfile();

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 sm:px-8">
        <h1 className="font-display text-title-page font-black leading-title">Pick a pal</h1>
        <p className="mt-3 max-w-measure text-lead text-ink-soft">
          No one around yet? Choose a pal who likes what you like, and chat for a bit. Start with an easy one.{" "}
          {APP_NAME} helps along the way.
        </p>
        <p className="mt-2 max-w-measure text-ink">These chats are short on purpose. Practice is a warm-up. Real people are the goal.</p>

        {mine === null && (
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-mini bg-paper p-4 ring-2 ring-line">
            <p className="font-bold">You need your own taste card first.</p>
            <LinkButton href="/create" className="min-h-12">
              Make my taste card
            </LinkButton>
          </div>
        )}

        <ul className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map((p) => {
            const href = mine ? `/practice/chat?persona=${p.id}` : "/create";
            const name = p.profile.name;
            return (
              <li key={p.id} className="flex flex-col items-center gap-4 text-center">
                <Link href={href} tabIndex={-1} aria-hidden className="group w-full max-w-[15rem]">
                  <TasteCard
                    profile={p.profile}
                    accent={p.color}
                    size="md"
                    fit
                    className="transition-transform duration-(--dur-base) ease-deal group-hover:-translate-y-1 group-hover:-rotate-2"
                  />
                </Link>
                <div className="flex flex-col items-center">
                  <LevelPill level={p.level} />
                  <p className="mt-2 font-bold">{p.vibe}</p>
                  <p className="text-ink-soft">{p.levelNote}</p>
                </div>
                <Link href={href} className={cn(buttonStyles.secondary, "mt-auto min-h-12 w-full max-w-[15rem] whitespace-nowrap px-4")}>
                  Chat with {name} <ArrowRight className="size-5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-10 text-label text-ink-soft">
          Pals are made up and played by AI. Their tastes are real titles that real fans love.
        </p>
      </main>
    </div>
  );
}
