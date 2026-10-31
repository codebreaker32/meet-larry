import { Suspense } from "react";
import { GroupChatPage } from "@/components/group/group-chat-page";
import { PageSkeleton } from "@/components/page-skeleton";

// One group chat. The id arrives as a param; it is read inside Suspense so the page shell can render
// first (Cache Components).
export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton label="Opening your group" activePath="/group" />}>
      <FromParams params={params} />
    </Suspense>
  );
}

async function FromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupChatPage id={decodeURIComponent(id)} />;
}
