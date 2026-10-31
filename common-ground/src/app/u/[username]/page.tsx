import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

// /u/<username> is only a doorway: profiles live at /profile/<username>, because usernames carry no
// "u/" (QuietOtter42, never u/QuietOtter42). Kept so older links and shared URLs still land.
export const metadata: Metadata = { title: "Profile", robots: { index: false, follow: false } };

export default function ShortProfilePage({ params }: { params: Promise<{ username: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <Forward params={params} />
    </Suspense>
  );
}

async function Forward({ params }: { params: Promise<{ username: string }> }): Promise<null> {
  const { username } = await params;
  let name = "";
  try {
    name = decodeURIComponent(username);
  } catch {
    name = "";
  }
  redirect(`/profile/${encodeURIComponent(name.replace(/[^A-Za-z0-9]/g, "").slice(0, 40))}`);
}
