import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/brand";
import { THEME_COLOR } from "@/lib/tokens";

// Installable on phones (Add to Home Screen). Colours must be literal, so they come from the
// hex mirror of --table in lib/tokens.ts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Talk to someone, not something. Swap taste cards with someone new and get something real to talk about.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ["social", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
