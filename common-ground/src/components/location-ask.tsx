"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { LarryAvatar } from "@/components/larry-avatar";
import { Button } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { declineLocation, requestLocation, type ApproxLocation } from "@/lib/location";
import { cn } from "@/lib/utils";

/**
 * D24: the ONE location ask, shown once in onboarding (right after "Save my card" on /create, and
 * on first sign-in). Use hasAnsweredLocationAsk() from "@/lib/location" to decide whether to show it.
 * "Share location" opens the browser's own prompt and stores a coarse point; "Not now" stores the
 * choice so nothing asks again. Settings on /me is the only way back in.
 *
 * `onDone(location)` gets the stored point, or null after "Not now" or a browser no.
 */
export function LocationAsk({
  onDone,
  headingLevel = 2,
  className,
}: {
  onDone?: (location: ApproxLocation | null) => void;
  /** The heading level for this screen (2 inside a page, 1 when it is the whole page). */
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [declined, setDeclined] = React.useState(false);
  const headingId = React.useId();
  const Heading = headingLevel === 1 ? "h1" : "h2";

  const share = async () => {
    if (busy) return;
    setBusy(true);
    const point = await requestLocation();
    setBusy(false);
    if (point) onDone?.(point);
    else {
      // The browser said no (or could not tell): say so kindly, once, then move on.
      setDeclined(true);
      onDone?.(null);
    }
  };

  const notNow = () => {
    declineLocation();
    onDone?.(null);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="location-ask"
      className={cn("flex flex-col items-center gap-4 rounded-panel border-2 border-ink bg-paper p-6 text-center", className)}
    >
      <LarryAvatar variant="full" size="xl" />
      <Heading id={headingId} className="font-display text-title-sm font-black text-ink">
        {APP_NAME} finds real places near you. Share your location?
      </Heading>
      <p className="max-w-(--measure) text-ink-soft">
        Only a rough spot, about 1 km. Nobody else sees it. Turn it off any time in Your taste.
      </p>
      {declined && (
        <p role="status" className="max-w-(--measure) text-ink">
          No problem. {APP_NAME} will still find great places. You can turn it on later in Your taste.
        </p>
      )}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button onClick={share} loading={busy} icon={<MapPin />}>
          Share location
        </Button>
        <Button variant="secondary" onClick={notNow}>
          Not now
        </Button>
      </div>
    </section>
  );
}
