"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

// Everything in Larry needs an account (user decision, 31 Oct): only the landing page, sign-in and
// sign-up are open. Anyone else is sent to sign in, and comes back to the page they asked for.
const OPEN = [/^\/$/, /^\/signin(\/|$)/, /^\/signup(\/|$)/];

export function SignInGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const open = OPEN.some((r) => r.test(pathname));
  // End-to-end tests drive pages with their own fake sign-in; the gate stays out of their way.
  const bypass = process.env.NEXT_PUBLIC_E2E === "1";
  const blocked = !open && !bypass && status !== "signed-in";

  React.useEffect(() => {
    if (!blocked || status === "loading") return;
    const next = encodeURIComponent(pathname + (typeof window !== "undefined" ? window.location.search : ""));
    router.replace(status === "needs-signup" ? `/signup?next=${next}` : `/signin?next=${next}`);
  }, [blocked, status, pathname, router]);

  if (blocked) return <div className="min-h-dvh" aria-busy="true" />;
  return <>{children}</>;
}
