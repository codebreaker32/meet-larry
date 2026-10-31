import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaceScreen } from "./place-screen";

// A place's page: the public top 3 under made-up place names, the person's own stage (only they see
// it) and one next step. Never indexed: a podium is for people who go there, not for search engines.
export const metadata: Metadata = { title: "A place", robots: { index: false, follow: false } };

export default function PlacePage({ params }: { params: Promise<{ placeId: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <PlaceFromParams params={params} />
    </Suspense>
  );
}

async function PlaceFromParams({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  return <PlaceScreen placeId={decodeURIComponent(placeId).slice(0, 200)} />;
}
