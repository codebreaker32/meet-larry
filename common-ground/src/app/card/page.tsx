"use client";

import { FingerprintPanel } from "@/components/fingerprint/fingerprint-panel";
import * as React from "react";
import { Drama, MessageCircle, Plus, ScanLine, Sparkles, Pencil } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { GROUP_NEW_HREF, SCAN_HREF, SiteHeader, SOLO_LABEL } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { APP_NAME } from "@/lib/brand";
import { GROUP_WORD } from "@/lib/groups/shared";
import { personaToProfile, usePersona } from "@/lib/persona";
import { PageSkeleton } from "@/components/page-skeleton";

const GROUP_LOWER = GROUP_WORD.toLowerCase();

export default function CardPage() {
  const persona = usePersona();
  // The card carries the top 10 picks; the rest of the persona stays on this phone.
  const profile = React.useMemo(
    () => (persona === undefined ? undefined : persona && persona.likes.length ? personaToProfile(persona) : null),
    [persona],
  );
  const total = persona?.likes.length ?? 0;

  if (profile === undefined) return <PageSkeleton label="Opening your card" />;

  if (profile === null) {
    return (
      <div className="flex flex-1 flex-col">
        <SiteHeader />
        <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-5 px-5">
          <h1 className="font-display text-title-lg font-black leading-none">No card yet</h1>
          <p className="text-lead text-ink-soft">Make one first. It takes about a minute.</p>
          <LinkButton href="/create">Make my taste card</LinkButton>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      {/* Phone: one column (title, card, buttons, other ways). Desktop: the card on the left, the
          title and the ways out beside it, so the page reads as one table, not a strip. */}
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-5 pb-12 lg:grid lg:max-w-5xl lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-x-16 lg:pt-6"
      >
        <div className="contents lg:flex lg:flex-col lg:items-center">
          <div className="order-2 mt-6 w-full max-w-[20rem] lg:order-none lg:mt-0">
            <TasteCard profile={profile} total={total} headingLevel={2} />
          </div>

          <div className="order-3 mt-8 flex w-full flex-col gap-3 lg:order-none">
            <p className="text-center text-ink-soft">
              {total > profile.items.length
                ? `Your card shows your top ${profile.items.length} picks. ${APP_NAME} keeps all ${total} on this phone.`
                : `${APP_NAME} learns more of your taste each time you chat.`}
            </p>
            {/* The Taste Fingerprint sits with the card: real Qloo numbers and a share image. */}
            <FingerprintPanel profile={profile} compact headingLevel={2} className="mt-3" />
          </div>
        </div>

        <div className="contents lg:flex lg:max-w-measure lg:flex-col">
          <div className="order-1 self-start lg:order-none">
            <h1 className="font-display text-title-page font-black leading-title">Your taste card</h1>
            <p className="mt-3 text-lead text-ink-soft">
              Start a {GROUP_LOWER} and show the QR to a friend. {APP_NAME} finds what you all like and helps you plan something real.
            </p>
          </div>

          <div className="order-4 mt-6 flex w-full flex-col gap-3 lg:order-none lg:mt-10">
            <LinkButton href="/create?edit=1&next=/card" variant="secondary">
              <Pencil className="size-5" aria-hidden /> Edit my card
            </LinkButton>
            <div className="flex flex-col gap-1.5">
              <LinkButton href={GROUP_NEW_HREF}>
                <Plus className="size-5" aria-hidden /> Start a {GROUP_LOWER}
              </LinkButton>
              <p className="px-2 text-ink-soft">2 to 5 people, each on their own phone. Needs an account (18+).</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <LinkButton href={SCAN_HREF} variant="secondary">
                <ScanLine className="size-5" aria-hidden /> Scan a group QR
              </LinkButton>
            </div>

            <h2 className="mt-4 font-display text-title-sm font-black">On this phone</h2>
            <div className="flex flex-col gap-1.5">
              <LinkButton href="/larry" variant="secondary">
                <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
              </LinkButton>
              <p className="px-2 text-ink-soft">
                No one around? {APP_NAME} is an AI. It finds more things you might like and learns your taste.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <LinkButton href="/practice" variant="secondary">
                <Drama className="size-5" aria-hidden /> Pick a pal
              </LinkButton>
              <p className="px-2 text-ink-soft">Warm up with a friendly pal first.</p>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <LinkButton href="/me" variant="quiet">
                <Sparkles className="size-4" aria-hidden /> Your taste, by {APP_NAME}
              </LinkButton>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
