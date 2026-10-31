"use client";

import * as React from "react";
import { LinkButton } from "@/components/link-button";
import { LiveRoom } from "@/components/meet-chat/live-room";
import { forgetCredentials, normalizeCode, useCredentials } from "@/components/meet-chat/room-api";
import { SiteHeader } from "@/components/site-header";

// /meet/chat/[code]: the live room a mutual wave opened (two people and Larry), with a Block or
// report button that stays in view above the chat. Only this phone's saved seat can open it;
// meet rooms can't be joined with the code.

export function MeetChat({ rawCode }: { rawCode: string }) {
  const code = normalizeCode(rawCode);
  const creds = useCredentials(code ?? "");
  const [gone, setGone] = React.useState(false);
  const onGone = React.useCallback(() => {
    setGone(true);
    if (code) forgetCredentials(code);
  }, [code]);

  if (!code || gone) return <Ended />;
  if (creds === undefined) return <div className="flex-1" />;
  if (!creds) return <Ended />;
  return (
    // Block or report sits in the room's header (and under "Who's here"), always one tap away.
    <LiveRoom key={creds.memberId} creds={creds} onGone={onGone} />
  );
}

function Ended() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-5 px-5 pb-16">
        <h1 className="font-display text-title-lg font-black leading-none">This chat has ended</h1>
        <p className="text-lead text-ink-soft">It may have closed, or it was opened on another phone. Meet chats can only be opened by the two people who waved.</p>
        <LinkButton href="/">Back home</LinkButton>
      </main>
    </div>
  );
}
