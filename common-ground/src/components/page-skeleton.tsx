import { SiteHeader, StaticSiteHeader } from "@/components/site-header";
import { Skeleton, SkeletonGroup } from "@/components/ui";

/**
 * What a client page shows before it has read this phone's storage (persona, steps, sign-in): the
 * real header and a still outline of the page, never a blank screen. It is also the page's static
 * shell, so a first visit paints the header and layout straight from the HTML, before any script runs.
 * Still fills only (DESIGN.md: no shimmer, no pulse), so it is the same under reduced motion.
 * On a dynamic route's Suspense fallback pass `activePath` (the section, e.g. "/group"): the URL is
 * not known while that shell is prerendered, so the header cannot read it.
 */
export function PageSkeleton({
  label = "Loading",
  tiles = false,
  activePath,
}: {
  label?: string;
  tiles?: boolean;
  activePath?: string;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {activePath === undefined ? <SiteHeader /> : <StaticSiteHeader activePath={activePath} />}
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16 pt-4 sm:px-8">
        <SkeletonGroup label={label} className="flex flex-col gap-4">
          <Skeleton className="h-10 w-3/4 rounded-mini" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          {tiles ? (
            <span aria-hidden className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} shape="block" className="aspect-[3/4] w-full" />
              ))}
            </span>
          ) : (
            <Skeleton shape="slot" className="mt-4 h-48 w-full" />
          )}
        </SkeletonGroup>
      </main>
    </div>
  );
}
