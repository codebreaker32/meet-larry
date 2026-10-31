"use client";

import * as React from "react";

/** Registers /sw.js so browsers offer "Install app" (production only; dev keeps hot reload simple). */
export function RegisterServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
