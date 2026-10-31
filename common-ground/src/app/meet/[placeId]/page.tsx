import type { Metadata } from "next";
import { Suspense } from "react";
import { MeetScreen } from "./meet-screen";

export const metadata: Metadata = { title: "Open to meet" };

// Open to meet at one venue. The place id arrives as a param and is read inside Suspense, so the
// page shell renders first (Cache Components).
export default function MeetPage({ params }: { params: Promise<{ placeId: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <MeetFromParams params={params} />
    </Suspense>
  );
}

async function MeetFromParams({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = await params;
  return <MeetScreen placeId={decodeURIComponent(placeId)} />;
}
