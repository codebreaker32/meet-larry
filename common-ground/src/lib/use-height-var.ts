"use client";

import * as React from "react";

/**
 * Keeps a CSS variable on <html> in sync with an element's height (0 when it isn't fixed or sticky).
 * globals.css turns `--header-h` and `--composer-h` into scroll padding, so a control that gets
 * keyboard focus is scrolled clear of a sticky header or a fixed bottom bar (WCAG 2.2 SC 2.4.11,
 * Focus Not Obscured). `mounted` re-runs the effect when the element appears or changes later
 * (pass anything that changes when it does).
 */
export function useHeightVar(ref: React.RefObject<HTMLElement | null>, name: string, mounted: unknown = true) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const pos = getComputedStyle(el).position;
      root.style.setProperty(name, `${pos === "fixed" || pos === "sticky" ? el.offsetHeight : 0}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(name);
    };
  }, [ref, name, mounted]);
}
