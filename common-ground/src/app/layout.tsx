import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Anybody, Atkinson_Hyperlegible } from "next/font/google";
import { AccessCodePrompt } from "@/components/access-code";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SignInGate } from "@/components/auth/sign-in-gate";
import { MotionProvider } from "@/components/motion-provider";
import { RegisterServiceWorker } from "@/components/register-sw";
import { SkipLink } from "@/components/skip-link";
import { APP_NAME } from "@/lib/brand";
import { THEME_COLOR } from "@/lib/tokens";
import "./globals.css";

// Atkinson Hyperlegible was designed for low-vision readers; it carries all reading text.
const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// Heavy, slightly expanded card-title face for names and headings only.
const anybody = Anybody({
  variable: "--font-anybody",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  // Each page names itself first ("First Steps | Larry"), so tabs and screen readers can tell them apart.
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "Talk to someone, not something. Swap taste cards with someone new and get something real to talk about.",
  applicationName: APP_NAME,
  // Installed from the home screen, it opens full screen like an app (manifest.ts covers Android).
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: {
    // app/favicon.ico is added by the file convention.
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Must be a literal colour (browser chrome); matches --table in globals.css.
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${atkinson.variable} ${anybody.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SkipLink />
        <MotionProvider>
          {/* Who is signed in (phone accounts). Loads nothing for people who never signed in. */}
          <RegisterServiceWorker />
          <AuthProvider>
            {/* The gate reads the URL, so it streams in; the prerendered page shows until it does. */}
            <Suspense fallback={children}>
              <SignInGate>{children}</SignInGate>
            </Suspense>
            {/* Opens by itself when an AI route answers 401/402 (no Larry time, or it is used up). */}
            {/* It reads the URL (usePathname) for the sign-in link, so it streams in after the static shell. */}
            <Suspense fallback={null}>
              <AccessCodePrompt />
            </Suspense>
          </AuthProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
