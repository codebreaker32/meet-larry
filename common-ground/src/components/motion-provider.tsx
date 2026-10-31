"use client";

import { MotionConfig } from "motion/react";

/**
 * Every motion component follows the phone's "reduce motion" setting: movement (deals, slides,
 * flips) is dropped and only fades remain. Components that check useReducedMotion themselves
 * still do; this catches the ones that don't (WCAG 2.3.3, and the CSS clamp in globals.css can't
 * reach JS-driven animation).
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
