"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Drama, Footprints, House, Menu, MessageCircle, Plus, ScanLine, Sparkles, Users, X } from "lucide-react";
import { AppCard } from "@/components/app-card";
import { InstallApp } from "@/components/install-app";
import { AccountHeaderLink } from "@/components/auth/account-header-link";
import { LarryAvatar } from "@/components/larry-avatar";
import { APP_NAME } from "@/lib/brand";
import { GROUP_WORD } from "@/lib/groups/shared";
import { cn } from "@/lib/utils";

/** Where groups live (D25, D26): your groups, "Start a group" and "Scan a group QR". */
export const GROUPS_HREF = "/group";
export const GROUP_NEW_HREF = "/group/new";
export const SCAN_HREF = "/scan";
/** @deprecated Rooms are gone: kept so older links land on "Start a group". Use GROUP_NEW_HREF. */
export const ROOM_HREF = GROUP_NEW_HREF;

/** The solo mode's name, everywhere it appears. */
export const SOLO_LABEL = `Talk taste with ${APP_NAME}`;

const navLink = "press press-flat flex min-h-12 items-center gap-2 rounded-full px-4 font-bold text-ink hover:bg-paper";

// Wide screens show the places people come back to ("Your taste" only where there is room).
// Phones get one Menu button with everything in it, so the header never crowds the logo.
const WIDE = [
  // Home shows on phones too, as an icon (its word is for screen readers there).
  { href: "/", label: "Home", Icon: House, className: "max-md:px-3" },
  { href: GROUPS_HREF, label: `${GROUP_WORD}s`, Icon: Users, className: "max-md:hidden" },
  { href: "/larry", label: SOLO_LABEL, Icon: MessageCircle, className: "max-md:hidden" },
  { href: "/me", label: "Your taste", Icon: Sparkles, className: "max-lg:hidden" },
  { href: "/steps", label: "First Steps", Icon: Footprints, className: "max-md:hidden" },
];

const MENU = [
  { href: "/", label: "Home", Icon: House },
  { href: "/steps", label: "First Steps", Icon: Footprints },
  { href: GROUPS_HREF, label: `Your ${GROUP_WORD.toLowerCase()}s`, Icon: Users },
  { href: GROUP_NEW_HREF, label: `Start a ${GROUP_WORD.toLowerCase()}`, Icon: Plus },
  { href: SCAN_HREF, label: "Scan a group QR", Icon: ScanLine },
  { href: "/larry", label: SOLO_LABEL, Icon: MessageCircle },
  { href: "/me", label: `Your taste, by ${APP_NAME}`, Icon: Sparkles },
  { href: "/practice", label: "Pick a pal", Icon: Drama },
];

type HeaderProps = { className?: string; children?: React.ReactNode };

export function SiteHeader(props: HeaderProps) {
  return <SiteHeaderView {...props} pathname={usePathname()} />;
}

/**
 * The header for a Suspense fallback on a dynamic route, where the URL is not known while the page
 * shell is prerendered (Cache Components). The caller names the section to mark as current.
 */
export function StaticSiteHeader({ activePath, ...props }: HeaderProps & { activePath: string }) {
  return <SiteHeaderView {...props} pathname={activePath} />;
}

function SiteHeaderView({ className, children, pathname }: HeaderProps & { pathname: string }) {
  const [open, setOpen] = React.useState(false);
  const menuId = React.useId();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Close on Escape (focus back on the button) and on a tap outside.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <header className={cn("relative z-40 flex items-center justify-between gap-2 px-4 py-4 sm:gap-3 sm:px-8", className)}>
      {/* Larry's face is the logo: the avatar tile and the wordmark. */}
      <Link href="/" className="flex min-h-12 items-center gap-2.5 rounded-tile pr-2" aria-label={`${APP_NAME} home`}>
        <LarryAvatar size="lg" decorative className="-rotate-3" />
        <span className="font-display text-title-sm font-black leading-none">{APP_NAME}</span>
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1">
        {children}
        {WIDE.map(({ href, label, Icon, className: shown }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
            className={cn(navLink, shown, (pathname === href || pathname.startsWith(`${href}/`)) && "bg-paper ring-2 ring-ink")}
          >
            <Icon className="size-5" aria-hidden />
            <span className={href === "/" ? "max-md:sr-only" : undefined}>{label}</span>
          </Link>
        ))}
        {/* Sign in, or the account's username (1F). On phones the username shrinks to its icon. */}
        {/* Its own boundary: it reads the URL, which a dynamic route's prerendered shell does not have.
            It shows nothing until sign-in state loads anyway, so the empty fallback looks the same. */}
        <React.Suspense fallback={null}>
          <AccountHeaderLink className="whitespace-nowrap max-sm:px-3" />
        </React.Suspense>
        <div ref={wrapRef} className="relative md:hidden">
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
            className={cn(navLink, "whitespace-nowrap max-sm:px-3", open && "bg-paper ring-2 ring-ink")}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            Menu
          </button>
          {open && (
            <div
              id={menuId}
              className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2.5rem))] rounded-panel border-2 border-ink bg-paper p-2 shadow-panel"
            >
              <ul className="flex flex-col gap-1">
                {MENU.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={pathname === href ? "page" : undefined}
                      className="flex min-h-12 items-center gap-3 rounded-full px-4 font-bold text-ink hover:bg-table aria-[current=page]:bg-table"
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
              {/* The app card stands apart from the links: its own row under a rule. */}
              <div className="mt-2 border-t-2 border-line pt-3 empty:hidden">
                <AppCard placement="menu" />
                <InstallApp className="mt-1" />
              </div>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
