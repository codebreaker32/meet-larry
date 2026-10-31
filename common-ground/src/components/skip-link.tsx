"use client";

/**
 * The first stop for a keyboard: jumps past the header to the page's <main> (WCAG 2.4.1 Bypass
 * Blocks). Hidden until it has focus, then an ink pill in the top corner. Every page renders one
 * <main id="main">; the click handler also makes it focusable so the next Tab starts inside it.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>("main");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
        main.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:inline-flex focus:min-h-12 focus:items-center focus:rounded-full focus:bg-ink focus:px-5 focus:font-bold focus:text-paper focus:shadow-button"
    >
      Skip to main content
    </a>
  );
}
