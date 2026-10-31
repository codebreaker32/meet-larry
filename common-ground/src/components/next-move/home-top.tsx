"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Drama, MessageCircle, Plus, ScanLine, Users } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { LinkButton } from "@/components/link-button";
import { GROUPS_HREF, SOLO_LABEL } from "@/components/site-header";
import { maybeSignedIn } from "@/lib/firebase/client";
import { GROUP_SCAN_HREF, GROUP_START_HREF, GROUP_WORD, PICK_A_PAL_HREF, TALK_TASTE_HREF } from "@/lib/next-move";
import { usePersona } from "@/lib/persona";
import { NextMovePopup } from "./next-move-popup";

const noSubscribe = () => () => {};
const noServerHint = () => false;

const inlineLink =
  "-my-3 inline-block py-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4";

/**
 * The top of home. Visitors (and anyone not signed in, including device-only people) get the
 * original hero, passed in from the server page. A signed-in person gets a short hello, the
 * "Larry's next move" pill and the normal buttons: Start a group, your groups, Talk taste, Pick a pal.
 */
export function HomeTop({ hero }: { hero: React.ReactNode }) {
  const { status, account } = useAuth();
  // Only a device that may be signed in waits for the answer; everyone else sees the hero at once.
  const hint = React.useSyncExternalStore(noSubscribe, maybeSignedIn, noServerHint);
  if (status === "signed-in") return <SignedInHome name={account?.name ?? ""} />;
  if (status === "loading" && hint) return <div aria-busy="true" className="min-h-96" />;
  return <>{hero}</>;
}

function SignedInHome({ name }: { name: string }) {
  const persona = usePersona();
  const noCard = persona === null || (persona !== undefined && persona.likes.length === 0);
  const group = GROUP_WORD.toLowerCase();

  return (
    <section aria-labelledby="home-hello" className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:px-8" data-testid="home-signed-in">
      <NextMovePopup signedIn className="mb-6" />
      <h1 id="home-hello" className="font-display text-title-page font-black leading-title">
        {name ? `Hi, ${name}.` : "Hi again."}
      </h1>
      <p className="mt-3 max-w-measure text-lead leading-relaxed text-ink-soft">
        {noCard
          ? "Start with your taste card. It only takes a few taps."
          : `Pick up where you left off, or start a ${group} with friends who are with you.`}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {noCard && (
          <LinkButton href="/create">
            Make my taste card <ArrowRight className="size-5" aria-hidden />
          </LinkButton>
        )}
        <LinkButton href={GROUP_START_HREF} variant={noCard ? "secondary" : "primary"}>
          <Plus className="size-5" aria-hidden /> Start a {group}
        </LinkButton>
        <LinkButton href={GROUPS_HREF} variant="secondary">
          <Users className="size-5" aria-hidden /> Your {group}s
        </LinkButton>
        <LinkButton href={TALK_TASTE_HREF} variant="secondary">
          <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
        </LinkButton>
        <LinkButton href={PICK_A_PAL_HREF} variant="secondary">
          <Drama className="size-5" aria-hidden /> Pick a pal
        </LinkButton>
      </div>
      <p className="mt-4 text-ink-soft">
        A friend showing you their QR?{" "}
        <Link href={GROUP_SCAN_HREF} className={inlineLink}>
          <ScanLine className="mr-1 inline size-5 align-text-bottom" aria-hidden />
          Scan a {group} QR
        </Link>
        <span className="sr-only">.</span>
      </p>
    </section>
  );
}
