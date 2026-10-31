import type { Metadata } from "next";
import { Suspense } from "react";
import { MeetChat } from "./meet-chat";

export const metadata: Metadata = { title: "Meet chat" };

// The chat a mutual wave opened: the live room, with Block and Report always one tap away.
export default function MeetChatPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <ChatFromParams params={params} />
    </Suspense>
  );
}

async function ChatFromParams({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <MeetChat rawCode={decodeURIComponent(code)} />;
}
