"use client";

import { ViewTransition, useEffect } from "react";

/**
 * The deal between pages. Next remounts this template whenever the top-level route changes, and runs
 * every navigation inside a React transition, so React's <ViewTransition> animates the swap through
 * the browser's View Transitions API with no config (node_modules/next/dist/docs/01-app/02-guides/
 * view-transitions.md). The leaving page fades out, the arriving one slides up onto the table
 * (globals.css `.page-deal`, 250ms, --ease-deal). `default="none"` keeps everything else still:
 * refreshes, Suspense reveals and in-page transitions never animate the whole page.
 *
 * Off under reduced motion (globals.css), and browsers without the API swap pages instantly. Focus,
 * scroll restoration and the DOM are Next's as before: the wrapper adds no element of its own.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  useEffect(enableTouchActive, []);
  return (
    <ViewTransition enter="page-deal" exit="page-deal" default="none">
      {children}
    </ViewTransition>
  );
}

let touchActiveOn = false;

/**
 * iOS Safari only applies :active to a touched element when some touchstart listener exists, so the
 * press feel (globals.css `.press`) would not show under a finger. One passive, empty listener on the
 * document fixes it for every control; it never blocks scrolling. Added once per page load.
 */
function enableTouchActive() {
  if (touchActiveOn) return;
  touchActiveOn = true;
  document.addEventListener("touchstart", noop, { passive: true });
}

function noop() {}
