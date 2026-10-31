import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInFlow } from "@/components/auth/sign-in-flow";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

export default function SignInPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-title-session font-black">Sign in with your phone</h1>
          <p className="max-w-measure text-lead text-ink-soft">
            For 18 and over. Sign in to make your card, start a group and plan with Larry.
          </p>
        </div>
        <Suspense fallback={<div className="min-h-40" />}>
          <SignInFlow />
        </Suspense>
      </main>
    </>
  );
}
