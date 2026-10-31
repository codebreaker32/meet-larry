"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Pencil, QrCode, User, Users } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { Button, Segmented } from "@/components/ui";
import { createGroup, GROUP_SIZES, GROUP_WORD_LOWER, type GroupSize } from "@/components/group/group-api";
import { GroupGate } from "@/components/group/group-gate";
import { saveJoinTicket } from "@/components/group/join-ticket";
import { APP_NAME } from "@/lib/brand";
import { personaToProfile, usePersona } from "@/lib/persona";

const SIZE_OPTIONS = GROUP_SIZES.map((n) => ({
  value: n,
  label: n === 2 ? "2, just us" : `${n} people`,
  icon: n === 2 ? <User className="size-5" /> : <Users className="size-5" />,
}));

export default function NewGroupPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-4 sm:px-8">
        <Suspense fallback={null}>
          <GroupGate>{() => <NewGroup />}</GroupGate>
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Start a group: pick how many people (counting you), then show the QR. Whoever scans it joins until
 * it's full. Larry opens the chat with the group's common ground once someone is in.
 */
function NewGroup() {
  const router = useRouter();
  const persona = usePersona();
  const profile = React.useMemo(() => (persona && persona.likes.length ? personaToProfile(persona) : persona === undefined ? undefined : null), [persona]);
  const [size, setSize] = React.useState<GroupSize>(2);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    if (!profile || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await createGroup(size, profile);
      // The QR stays with this tab only, so the chat can keep showing it while people join.
      saveJoinTicket(out.group.id, out.join);
      router.push(`/group/${encodeURIComponent(out.group.id)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="font-display text-title-page font-black leading-title">Start a {GROUP_WORD_LOWER}</h1>
      <p className="mt-3 max-w-measure text-lead text-ink-soft">
        Pick how many of you there are. Then show your QR, and friends scan it with their phone camera to join.
      </p>

      {profile === undefined ? (
        <div className="mt-8 h-64" aria-hidden />
      ) : profile === null ? (
        <section className="mt-8 flex flex-col items-start gap-3 rounded-panel border-2 border-ink bg-paper p-5">
          <h2 className="font-display text-title-sm font-black">First, your taste card</h2>
          <p className="text-ink-soft">{APP_NAME} finds what your {GROUP_WORD_LOWER} shares from everyone&apos;s cards. It takes about a minute.</p>
          <LinkButton href="/create">
            <Pencil className="size-5" aria-hidden /> Make my taste card
          </LinkButton>
        </section>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          <Segmented
            label="How many people, counting you?"
            labelClassName="font-display text-title-sm font-black"
            options={SIZE_OPTIONS}
            value={size}
            onChange={setSize}
            layout="even"
            size="lg"
          />
          <p className="-mt-3 text-ink-soft">
            {size === 2
              ? `A one-to-one chat with one friend, and ${APP_NAME} when you tag it.`
              : `You and ${size - 1} friends, and ${APP_NAME} when you tag it.`}
          </p>
          <div className="flex items-center gap-4 rounded-panel bg-paper p-4 ring-2 ring-line">
            <TasteCard profile={profile} size="sm" className="shrink-0 -rotate-2" />
            <p className="min-w-0 flex-1 text-body">
              You join with your card, {profile.name}. Everyone in the {GROUP_WORD_LOWER} sees your name and your picks, never your phone number.
            </p>
          </div>
          {error && (
            <p role="alert" className="font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button icon={<QrCode />} loading={busy} onClick={start}>
              Show the QR
            </Button>
            <LinkButton href="/group" variant="quiet">
              <MessageCircle className="size-4" aria-hidden /> My {GROUP_WORD_LOWER}s
            </LinkButton>
          </div>
        </div>
      )}
    </>
  );
}
