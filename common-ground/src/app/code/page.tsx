import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessCodePageBody } from "@/components/access-code";
import { LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Access code",
  // A page for people who were given a code; nothing here for search engines.
  robots: { index: false },
};

export default function CodePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-title-session font-black">Your access code</h1>
          <p className="max-w-measure text-lead text-ink-soft">
            Chatting with {APP_NAME}, an AI pal, uses a little Larry time. Signing in with your phone gives you your
            own. Got an access code instead? Type it here. Your taste card, rooms and First Steps work without either.
          </p>
          <LinkButton href="/signin?next=%2Flarry" variant="secondary" className="self-start">
            Sign in with your phone
          </LinkButton>
        </div>
        <Suspense fallback={<div className="min-h-40" />}>
          <AccessCodePageBody />
        </Suspense>
      </main>
    </>
  );
}
