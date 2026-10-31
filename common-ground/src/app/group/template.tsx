"use client";

import { ViewTransition } from "react";

/**
 * The deal inside the groups section (list, Start a group, one chat). The root template only remounts
 * when the top-level route changes, so moving between /group pages would otherwise swap instantly.
 * Same `.page-deal` animation as the root (globals.css). React only fires enter/exit on the outermost
 * boundary that mounts, so arriving from another section deals once, not twice. Off under reduced motion.
 */
export default function GroupTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-deal" exit="page-deal" default="none">
      {children}
    </ViewTransition>
  );
}
