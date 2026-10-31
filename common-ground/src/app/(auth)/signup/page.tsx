import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpFlow } from "@/components/auth/sign-up-flow";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Make your account",
  robots: { index: false },
};

export default function SignUpPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
        <h1 className="font-display text-title-session font-black">Make your account</h1>
        <Suspense fallback={<div className="min-h-40" />}>
          <SignUpFlow />
        </Suspense>
      </main>
    </>
  );
}
