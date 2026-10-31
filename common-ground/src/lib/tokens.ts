/**
 * The design tokens TypeScript needs, mirrored from src/app/globals.css, which stays the source of
 * truth. Use these only where a CSS variable cannot reach:
 * - metadata and the web manifest (theme colour), and canvas drawing (the QR code): PALETTE hex values;
 * - colours stored as data (seat colours on room members): CSS variable strings;
 * - framer-motion, which needs the deal curve as numbers: EASE_DEAL and DURATION.
 * Components otherwise use the Tailwind utilities (bg-seat-1, ease-deal, border-border-control ...).
 * domain-style.test.ts checks every value here against globals.css, so the two cannot drift.
 */

/** Neutral primitives as hex, for places that cannot read CSS variables. */
export const PALETTE = {
  table: "#f4f1ff",
  ink: "#14121f",
  paper: "#ffffff",
} as const;

/** Browser chrome and the installed-app splash: the table the cards are laid on. */
export const THEME_COLOR = PALETTE.table;

/** The QR code on invites: ink modules on paper. */
export const QR_COLORS = { dark: PALETTE.ink, light: PALETTE.paper } as const;

/**
 * One ordered list of seat colours for every room and pair session, so the third
 * person in a room gets the same colour on every path. Seat colours borrow category frames, so a seat
 * always comes with a second cue as well (a name, an initial or its position), never colour alone.
 */
export const SEAT_COLORS = ["var(--seat-1)", "var(--seat-2)", "var(--seat-3)", "var(--seat-4)", "var(--seat-5)"] as const;

export type SeatColor = (typeof SEAT_COLORS)[number];

/** The seat colour for the person at `index` (0-based), wrapping after five. */
export function seatColorAt(index: number): SeatColor {
  const n = SEAT_COLORS.length;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return SEAT_COLORS[((i % n) + n) % n];
}

/** Seat colours saved before the seat tokens, in the order rooms used to hand them out. */
const LEGACY_SEATS: Record<string, SeatColor> = {
  "var(--film)": "var(--seat-1)",
  "var(--music)": "var(--seat-2)",
  "var(--games)": "var(--seat-3)",
  "var(--books)": "var(--seat-4)",
  "var(--tv)": "var(--seat-5)",
};

/** A stored seat colour as a seat token: old category colours map to their seat, others pass through. */
export function normalizeSeatColor(color: string): string {
  return LEGACY_SEATS[color] ?? color;
}

/** The one deal motion, `--ease-deal` as a cubic-bezier for framer-motion. */
export const EASE_DEAL = [0.16, 1, 0.3, 1] as const;

/** `--dur-quick`, `--dur-base` and `--dur-deal` in seconds, for framer-motion. */
export const DURATION = { quick: 0.18, base: 0.25, deal: 0.6 } as const;

/**
 * Vibration patterns in milliseconds for lib/haptics.ts: a tick is one short tap under the finger on a
 * primary action; success is tap, pause, firmer tap for the big moments (a check-in counted, Glory).
 */
export const HAPTIC = { tick: 8, success: [14, 60, 28] } as const;
