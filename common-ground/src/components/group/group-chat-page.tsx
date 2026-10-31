"use client";

import { GroupChat } from "./group-chat";
import { GroupGate } from "./group-gate";
import { SiteHeader } from "@/components/site-header";

/** The chat behind the account gate: groups are for signed-in accounts (18+). */
export function GroupChatPage({ id }: { id: string }) {
  return (
    <GroupGate
      fallbackShell={(gate) => (
        <div className="flex flex-1 flex-col">
          <SiteHeader />
          <main id="main" className="flex-1 px-4 pb-16">
            {gate}
          </main>
        </div>
      )}
    >
      {() => <GroupChat id={id} />}
    </GroupGate>
  );
}
