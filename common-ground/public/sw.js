// Larry's service worker: makes the site installable as an app. It does not cache pages or data
// (everything stays fresh from the network); it only passes requests through.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Same-origin GETs only; everything else (Firebase sign-in, other hosts) goes straight to the browser.
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req));
});
