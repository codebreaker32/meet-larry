"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Drama, LogIn, MessageCircle, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { LarryMoment } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import { SOLO_LABEL } from "@/components/site-header";
import { APP_NAME } from "@/lib/brand";
import type { Account } from "@/lib/types/account";
import { GROUP_WORD, GROUP_WORD_LOWER } from "./group-api";

/**
 * Groups are for signed-in accounts, and accounts are 18+ (D4). Everyone else keeps the device-only
 * Larry: the card, Talk taste, Pick a pal, places and check-ins. This gate shows that warmly instead
 * of a dead end, and sends people back here after signing in.
 */
export function GroupGate({
  children,
  fallbackShell = (node) => node,
}: {
  children: (account: Account) => React.ReactNode;
  /** Wraps the loading line and the gate (the chat page brings its own header only once in). */
  fallbackShell?: (node: React.ReactNode) => React.ReactNode;
}) {
  const { status, account } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();
  const here = `${pathname}${query ? `?${query}` : ""}`;

  if (status === "loading") {
    return fallbackShell(<LarryMoment kind="thinking" title="One moment" className="mx-auto mt-16" />);
  }
  if (status === "signed-in" && account) return <>{children(account)}</>;

  const needsSignup = status === "needs-signup";
  return fallbackShell(
    <section aria-labelledby="gate-title" className="mx-auto mt-6 flex max-w-md flex-col gap-4 rounded-panel border-2 border-ink bg-paper p-5 sm:p-6">
      <h1 id="gate-title" className="font-display text-title-md font-black leading-tight">
        {needsSignup ? "One last step" : `${GROUP_WORD}s are for accounts`}
      </h1>
      <p className="text-lead text-ink-soft">
        {needsSignup
          ? `Finish making your account, then you're straight back here.`
          : `Sign in with your phone number to start or join a ${GROUP_WORD_LOWER}. Accounts are for people 18 and over.`}
      </p>
      <LinkButton href={`/${needsSignup ? "signup" : "signin"}?next=${encodeURIComponent(here)}`}>
        <LogIn className="size-5" aria-hidden /> {needsSignup ? "Finish my account" : "Sign in"}
      </LinkButton>
      <div className="border-t-2 border-line pt-4">
        <h2 className="font-display text-title-sm font-black">Without an account</h2>
        <p className="mt-1 text-body text-ink-soft">{APP_NAME} still works on this phone: your card, places and check-ins.</p>
        <div className="mt-3 flex flex-col gap-2">
          <LinkButton href="/larry" variant="secondary">
            <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
          </LinkButton>
          <LinkButton href="/practice" variant="secondary">
            <Drama className="size-5" aria-hidden /> Pick a pal
          </LinkButton>
          <LinkButton href="/card" variant="quiet">
            <Sparkles className="size-4" aria-hidden /> My taste card
          </LinkButton>
        </div>
      </div>
    </section>,
  );
}
