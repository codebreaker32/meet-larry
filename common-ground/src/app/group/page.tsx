"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Plus, ScanLine, Ticket, Users } from "lucide-react";
import { LarryMoment } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { GROUP_WORD, GROUP_WORD_LOWER, type GroupSummary, joinNames, listGroups } from "@/components/group/group-api";
import { GroupGate } from "@/components/group/group-gate";
import { APP_NAME } from "@/lib/brand";

/** After Leave, Unfriend, Block or Report: one calm line, never a warning. */
const CLOSED_TEXT: Record<string, string> = {
  left: `You left the ${GROUP_WORD_LOWER}. Nobody was told why.`,
  unfriend: "Done. They aren't told, and your shared chats are closed.",
  block: "Done. They've vanished from your Larry for good.",
  report: "Thanks for telling us. They're blocked for you, and we'll take a look.",
};

export default function GroupsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4 sm:px-8">
        <Suspense fallback={null}>
          <GroupGate>{() => <Groups />}</GroupGate>
        </Suspense>
      </main>
    </div>
  );
}

function Groups() {
  const params = useSearchParams();
  const closed = CLOSED_TEXT[params.get("closed") ?? ""];
  const [groups, setGroups] = React.useState<GroupSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    listGroups(ctrl.signal)
      .then((out) => setGroups(out.groups))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <>
      <h1 className="font-display text-title-page font-black leading-title">Your {GROUP_WORD_LOWER}s</h1>
      <p className="mt-3 max-w-measure text-lead text-ink-soft">
        Every chat is a {GROUP_WORD_LOWER} of 2 to 5 friends, made by QR. {APP_NAME} finds what you all like and helps you
        plan something real.
      </p>
      {closed && (
        <p role="status" className="mt-4 rounded-mini bg-paper p-3 font-bold text-ink ring-2 ring-line">
          {closed}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <LinkButton href="/group/new">
          <Plus className="size-5" aria-hidden /> Start a {GROUP_WORD_LOWER}
        </LinkButton>
        <LinkButton href="/scan" variant="secondary">
          <ScanLine className="size-5" aria-hidden /> Scan a group QR
        </LinkButton>
      </div>

      <section aria-labelledby="list-title" className="mt-10">
        <h2 id="list-title" className="font-display text-title-sm font-black">
          {GROUP_WORD}s you&apos;re in
        </h2>
        {error && (
          <p role="alert" className="mt-3 font-bold text-danger">
            {error}
          </p>
        )}
        {!groups && !error && <LarryMoment kind="thinking" layout="row" title="Finding your groups" className="mt-4" />}
        {groups && groups.length === 0 && (
          <LarryMoment kind="empty" layout="row" className="mt-4" title={`No ${GROUP_WORD_LOWER}s yet. Start one, and show the QR to a friend.`} />
        )}
        {groups && groups.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/group/${encodeURIComponent(g.id)}`}
                  className="flex min-h-14 items-center gap-3 rounded-panel border-2 border-ink bg-paper px-4 py-3 hover:bg-table"
                >
                  <Users className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{g.names.length ? joinNames(g.names) : "Waiting for people to join"}</span>
                    <span className="block text-label text-ink-soft">
                      {GROUP_WORD} of {g.size}
                      {g.openSeats > 0 ? `, ${g.openSeats} ${g.openSeats === 1 ? "seat" : "seats"} open` : ""}
                    </span>
                    {g.plan ? (
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-label font-bold text-ink">
                        <Ticket className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">Plan: {g.plan}</span>
                      </span>
                    ) : g.names.length > 0 ? (
                      <span className="block truncate text-label text-ink-soft">No plan yet. Tag @{APP_NAME} and pick Plan.</span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-5 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
