"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth-provider";

// The account's place in the site header (1U mounts it in SiteHeader). Signed out: "Sign in".
// Signed in: the public username, to /me. Nothing while the state is still loading, so it never
// flashes the wrong label. Same 48px pill as the other header links; on phones the words become
// screen-reader only (a 48px icon target), so the header never grows wider than the screen.

const pill = "flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full px-3 font-bold text-ink hover:bg-paper sm:px-4";

export function AccountHeaderLink({ className }: { className?: string }) {
  const { status, account } = useAuth();
  const pathname = usePathname() ?? "/";
  if (status === "loading") return null;
  if (status === "signed-in" && account) {
    return (
      <Link href="/me#account" className={cn(pill, className)} aria-label={`Your account, ${account.username}`}>
        <CircleUserRound aria-hidden className="size-5 shrink-0" />
        <span className="max-sm:sr-only">{account.username}</span>
      </Link>
    );
  }
  if (status === "needs-signup") {
    return (
      <Link href={`/signup?next=${encodeURIComponent(pathname)}`} className={cn(pill, className)}>
        <CircleUserRound aria-hidden className="size-5 shrink-0" />
        <span className="max-sm:sr-only">Finish sign-up</span>
      </Link>
    );
  }
  if (pathname.startsWith("/signin") || pathname.startsWith("/signup")) return null;
  return (
    <Link href={`/signin?next=${encodeURIComponent(pathname)}`} className={cn(pill, className)}>
      <LogIn aria-hidden className="size-5 shrink-0" />
      <span className="max-sm:sr-only">Sign in</span>
    </Link>
  );
}
