"use client";

import * as React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Download } from "lucide-react";
import { ButtonSpinner, buttonStyles } from "@/components/link-button";
import { IosInstallSteps, promptInstall, useInstallState } from "@/components/install-app";
import { LARRY_ASSETS } from "@/components/larry-avatar";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

// "Get the Larry app", designed from the personas (research/user-research-plan.md, section
// "Install app"). Rules:
// - Offered only after a real win: a saved card, the first Plan Ticket, the first check-in. The
//   builder of that moment calls showAppCardAfterWin(reason) and, if it returns true, renders
//   <AppCard placement="win" reason={reason}/> right there.
// - Never on the first visit (a win on the first visit unlocks it from the next visit), never to
//   someone whose visit started from a QR (a scanned group QR), never in chats or groups.
// - The menu and the landing show the same card once a win has unlocked it.
// - "Not now" hides it for 14 days. "Don't ask again" hides it forever. A win pops it at most once
//   per visit. Gone once installed, and wherever this browser can't install.
// - It stands out: ink panel, the real app icon, its own row.

export type AppWinReason = "card-saved" | "plan-ticket" | "check-in";
export type AppCardPlacement = "menu" | "landing" | "win";

export const APP_CARD_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const KEY = {
  win: "larry.app.win",
  snooze: "larry.app.snooze",
  never: "larry.app.never",
  firstVisit: "larry.visit.first",
} as const;
const SESSION = {
  visit: "larry.visit",
  qr: "larry.app.qr",
  offered: "larry.app.offered",
} as const;
const EVENT = "larry:app-card";

const BENEFIT: Record<AppWinReason | "default", string> = {
  default: `Open ${APP_NAME} in one tap, like any other app.`,
  "card-saved": "Your taste card, one tap from your home screen.",
  "plan-ticket": "Your Plan Tickets, one tap from your home screen.",
  "check-in": "Check-ins are one tap from your home screen.",
};

/** Chats and groups: never here (the menu and landing cards stay away). */
const QUIET_ROUTES = [/^\/group(\/|$)/, /^\/scan/, /^\/g(\/|$)/, /^\/meet/, /^\/larry/, /^\/practice\/.+/];

function local(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
function get(store: Storage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function set(store: Storage | null, key: string, value: string) {
  try {
    store?.setItem(key, value);
  } catch {
    // Storage refused (private mode): the card simply behaves as if nothing was saved.
  }
}
function emit() {
  window.dispatchEvent(new Event(EVENT));
}

/** True when this visit (browser tab session) started on a QR link: someone else's group QR. */
export function isQrEntry(url: string): boolean {
  try {
    const u = new URL(url, "http://x");
    // A scanned group QR opens /scan#t=<token> (or the short /g#t=<token>); /scan alone is the scan help page.
    return (u.pathname === "/scan" || u.pathname === "/g") && /(^#|&)t=/.test(u.hash);
  } catch {
    return false;
  }
}

// Mark the visit once per tab session, at module load: the first visit ever, and whether this
// visit began on a QR link (read from the page's real first load, not the current route).
if (typeof window !== "undefined") {
  const s = session();
  if (!get(s, SESSION.visit)) {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
    set(s, SESSION.visit, id);
    if (!get(local(), KEY.firstVisit)) set(local(), KEY.firstVisit, id);
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (isQrEntry(nav?.name ?? window.location.href)) set(s, SESSION.qr, "1");
  }
}

interface Prefs {
  reason: AppWinReason | null;
  eligible: boolean;
  offered: boolean;
}

function readWin(): { reason: AppWinReason; at: number } | null {
  try {
    const v = JSON.parse(get(local(), KEY.win) ?? "null") as { reason?: string; at?: number } | null;
    if (v && (v.reason === "card-saved" || v.reason === "plan-ticket" || v.reason === "check-in") && typeof v.at === "number") {
      return { reason: v.reason, at: v.at };
    }
  } catch {
    // Unreadable: treated as no win yet.
  }
  return null;
}

/** Whether the card may show at all on this visit (install support is checked separately). */
export function appCardAllowed(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  if (get(local(), KEY.never) === "1") return false;
  if (Number(get(local(), KEY.snooze) ?? 0) > now) return false;
  if (!readWin()) return false;
  const visit = get(session(), SESSION.visit);
  if (!visit || get(local(), KEY.firstVisit) === visit) return false;
  if (get(session(), SESSION.qr) === "1") return false;
  return true;
}

/**
 * Call at a real win: after "Save my card", the first Plan Ticket, the first check-in. Records the
 * win (it unlocks the card in the menu and on the landing) and returns true when you should render
 * <AppCard placement="win" reason={reason}/> now: allowed on this visit, not yet offered this
 * visit, and this browser can install. Safe to call on every win; it decides.
 */
export function showAppCardAfterWin(reason: AppWinReason): boolean {
  if (typeof window === "undefined") return false;
  set(local(), KEY.win, JSON.stringify({ reason, at: Date.now() }));
  emit();
  if (!appCardAllowed() || get(session(), SESSION.offered) === "1") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

/** "Not now": hidden everywhere for 14 days. */
export function snoozeAppCard(now = Date.now()) {
  set(local(), KEY.snooze, String(now + APP_CARD_SNOOZE_MS));
  emit();
}

/** "Don't ask again": hidden forever on this device. */
export function neverAskAppCard() {
  set(local(), KEY.never, "1");
  emit();
}

/** The one win card that popped this visit (its useId), so it stays while others stay away. */
let winClaimant: string | null = null;

let cachedKey = "";
let cached: Prefs = { reason: null, eligible: false, offered: false };
const SERVER: Prefs = { reason: null, eligible: false, offered: false };

function snapshot(): Prefs {
  const reason = readWin()?.reason ?? null;
  const eligible = appCardAllowed();
  const offered = get(session(), SESSION.offered) === "1";
  const key = `${reason}|${eligible}|${offered}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = { reason, eligible, offered };
  }
  return cached;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * The app card. One tap on "Get the app" opens the browser's install sheet (Android, Chrome, Edge)
 * or the iPhone picture steps. Renders nothing when the rules above say no.
 */
export function AppCard({
  placement,
  reason,
  className,
}: {
  placement: AppCardPlacement;
  /** The win that brought it up (placement "win"); otherwise the last recorded win picks the line. */
  reason?: AppWinReason;
  className?: string;
}) {
  const install = useInstallState();
  const prefs = React.useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const id = React.useId();
  const titleId = React.useId();
  const stepsId = React.useId();

  const quietHere = placement !== "win" && QUIET_ROUTES.some((r) => r.test(pathname));
  const wantsWinSlot = placement === "win" && install !== "hidden" && install !== "manual" && prefs.eligible;

  // A win pops the card once per visit: the first win card to show claims the visit.
  React.useEffect(() => {
    if (!wantsWinSlot || winClaimant === id || get(session(), SESSION.offered) === "1") return;
    winClaimant = id;
    set(session(), SESSION.offered, "1");
    emit();
  }, [wantsWinSlot, id]);

  if (install === "hidden" || install === "manual" || !prefs.eligible || quietHere) return null;
  if (placement === "win" && prefs.offered && winClaimant !== id) return null;

  const line = BENEFIT[reason ?? prefs.reason ?? "default"];

  const get_ = async () => {
    if (install === "ios") {
      setOpen((o) => !o);
      return;
    }
    if (asking) return;
    setAsking(true);
    await promptInstall();
    setAsking(false);
  };

  const subtle =
    "press press-flat inline-flex min-h-12 items-center rounded-full px-4 text-label font-bold text-paper underline decoration-paper-soft decoration-2 underline-offset-4 hover:bg-ink-hover";

  return (
    <section
      aria-labelledby={titleId}
      data-testid="app-card"
      data-placement={placement}
      className={cn("flex flex-col gap-4 rounded-panel bg-ink p-4 text-paper shadow-panel sm:p-5", className)}
    >
      <div className="flex items-center gap-3">
        <Image
          src={LARRY_ASSETS.appIcon}
          width={192}
          height={192}
          sizes="56px"
          alt=""
          aria-hidden
          draggable={false}
          className="size-14 shrink-0 rounded-tile ring-2 ring-paper"
        />
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-title-sm font-black leading-tight text-paper">
            Get the {APP_NAME} app
          </h2>
          <p className="text-paper-soft">{line}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={get_}
        aria-expanded={install === "ios" ? open : undefined}
        aria-controls={install === "ios" ? stepsId : undefined}
        aria-disabled={asking || undefined}
        aria-busy={asking || undefined}
        className={cn(buttonStyles.secondary, "w-full border-paper")}
      >
        {asking ? <ButtonSpinner /> : <Download className="size-5" aria-hidden />}
        {install === "ios" ? (open ? "Hide the steps" : "Show me how") : "Get the app"}
      </button>
      {install === "ios" && open && <IosInstallSteps id={stepsId} />}
      <div className="-mx-2 -mb-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => snoozeAppCard()} className={subtle}>
          Not now
        </button>
        <button type="button" onClick={() => neverAskAppCard()} className={subtle}>
          Don&apos;t ask again
        </button>
      </div>
    </section>
  );
}
