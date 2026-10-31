import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileScreen } from "./profile-screen";

// A person's profile by username. The server decides what this viewer may see (stranger, friend or
// owner) before anything leaves it. Never indexed.
export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default function UserPage({ params }: { params: Promise<{ username: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <UserFromParams params={params} />
    </Suspense>
  );
}

async function UserFromParams({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileScreen username={decodeURIComponent(username).slice(0, 40)} />;
}
