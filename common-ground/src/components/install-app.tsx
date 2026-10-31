"use client";

import * as React from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

// The install plumbing under <AppCard/> (src/components/app-card.tsx): the browser's own install
// prompt where there is one (Android, Chrome, Edge), picture steps on iPhone and iPad, and nothing
// once the app is installed.

/** Chrome and Edge's install event (not in the DOM typings yet). */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser fires beforeinstallprompt once, often before React mounts, so it is caught here at
// module load and kept in a tiny store the card reads.
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", cb);
  };
}

/** hidden: installed already, or this browser can't install. prompt: native prompt. ios: picture steps. */
export type InstallState = "hidden" | "prompt" | "ios" | "manual";

function readState(): InstallState {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installed || standalone) return "hidden";
  if (deferred) return "prompt";
  // iPhone and iPad have no install event: Safari's Share menu does it. iPadOS reports a Mac with touch.
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // No install event here (Firefox, desktop Safari, or Chrome before it offers one): show the menu steps.
  return ios ? "ios" : "manual";
}

/** How this browser can install Larry right now ("hidden" on the server). */
export function useInstallState(): InstallState {
  return React.useSyncExternalStore(subscribe, readState, () => "hidden" as InstallState);
}

/**
 * Opens the browser's own install sheet. Resolves to the person's choice, or null when there was no
 * prompt to show. The event works once: afterwards the state is "hidden" until the browser offers again.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const e = deferred;
  if (!e) return null;
  let outcome: "accepted" | "dismissed" | null = null;
  try {
    await e.prompt();
    outcome = (await e.userChoice).outcome;
  } catch {
    // The browser refused to show it (already used).
  }
  deferred = null;
  if (outcome === "accepted") installed = true;
  notify();
  return outcome;
}

/** One picture step: a big copy of the icon Safari shows, then a short line. */
function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-tile bg-paper text-ink ring-2 ring-paper [&>svg]:size-7">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="sr-only">Step {n}: </span>
        {children}
      </span>
    </li>
  );
}

/**
 * Add to Home Screen on iPhone and iPad, as picture steps with the same icons Safari uses (Share is
 * a square with an arrow up; Add to Home Screen is a square with a plus). Made for an ink panel.
 */
export function IosInstallSteps({ id, className }: { id?: string; className?: string }) {
  return (
    <ol id={id} className={cn("flex flex-col gap-3 text-paper", className)}>
      <Step n={1} icon={<Share />}>
        Tap <span className="font-bold">Share</span> in Safari. On newer iPhones, tap the{" "}
        <span className="font-bold">three dots</span> first.
      </Step>
      <Step n={2} icon={<SquarePlus />}>
        Tap <span className="font-bold">Add to Home Screen</span>. You may need to scroll down a little.
      </Step>
      <Step n={3} icon={<span className="font-display text-label font-black">Add</span>}>
        Tap <span className="font-bold">Add</span>. {APP_NAME} is now on your home screen.
      </Step>
    </ol>
  );
}

/**
 * An always-there "Install app" button (header menu and landing): the browser's own prompt where it
 * offers one, picture steps on iPhone, and plain menu steps elsewhere. Gone once installed.
 */
export function InstallApp({ className }: { className?: string }) {
  const state = useInstallState();
  const [open, setOpen] = React.useState(false);
  const stepsId = React.useId();
  if (state === "hidden") return null;
  const steps = state === "ios" || state === "manual";
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => (steps ? setOpen((o) => !o) : void promptInstall())}
        aria-expanded={steps ? open : undefined}
        aria-controls={steps ? stepsId : undefined}
        className="press press-flat inline-flex min-h-12 items-center gap-2 rounded-full px-4 font-bold text-ink hover:bg-paper"
      >
        <Download className="size-5" aria-hidden /> Install app
      </button>
      {open && state === "ios" && <IosInstallSteps id={stepsId} className="mt-2" />}
      {open && state === "manual" && (
        <p id={stepsId} className="mt-2 max-w-xs rounded-mini bg-paper p-3 ring-2 ring-ink">
          Open your browser menu and tap <span className="font-bold">Install app</span> or{" "}
          <span className="font-bold">Add to Home screen</span>. Larry then opens like an app.
        </p>
      )}
    </div>
  );
}
