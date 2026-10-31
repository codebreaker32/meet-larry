import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Static CSP, not a per-request nonce: cacheComponents/PPR static shells cannot carry a nonce
// (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). Next's inline bootstrap
// and Flight scripts therefore need 'unsafe-inline'; src/ injects no HTML. object-src, base-uri,
// form-action, frame-ancestors and the connect/frame host allowlists still hold. The Google hosts are
// for Firebase phone sign-in (reCAPTCHA, Identity Toolkit). Firestore client access is denied by the
// rules, so firestore.googleapis.com is deliberately absent. Qloo art goes through /_next/image and QR
// codes are data: URLs, so img-src stays same-origin. 'unsafe-eval' is dev-only (React dev tooling;
// the e2e web server runs `next dev`). upgrade-insecure-requests is left out: Caddy already redirects
// to HTTPS and the directive breaks http://localhost runs. The Firebase auth host comes from the env,
// so the repo names no project; a build without it simply leaves that frame host out.
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
const authFrame = authDomain && /^[a-z0-9.-]+$/i.test(authDomain) ? ` https://${authDomain}` : "";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://apis.google.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  `frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/${authFrame}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // The app uses geolocation and the mic (speech-to-text) itself; QR codes are only shown, never scanned.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a production build run beside a live `next dev` without touching .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  cacheComponents: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // firebase-admin (accounts, Firestore) runs in Node as is; never bundle it. It is on Next's
  // default list too, but named here so the dependency is explicit.
  serverExternalPackages: ["firebase-admin"],
  partialPrefetching: true,
  // Keeps the dev badge out of review screenshots.
  devIndicators: false,
  images: {
    // Poster and cover art from Qloo.
    remotePatterns: [{ protocol: "https", hostname: "images.qloo.com", pathname: "/i/**" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
