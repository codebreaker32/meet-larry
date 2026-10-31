"use client";

import * as React from "react";
import { success } from "@/lib/haptics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin, QrCode, Ticket, WifiOff } from "lucide-react";
import type { Seat } from "@/components/bridge-card";
import { LarryAvatar, LarryMoment } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import type { FitPeople } from "@/components/place-card";
import { PlanTicketView } from "@/components/plan-ticket";
import { Button, ChatBubble, Dialog } from "@/components/ui";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { APP_NAME } from "@/lib/brand";
import type { PlanTicket } from "@/lib/contracts";
import { applyPersonaUpdate, isEmptyUpdate, loadPersona, savePersona } from "@/lib/persona";
import { parseLarryCommand } from "@/lib/larry-commands";
import { readStoredLocation, requestLocation } from "@/lib/location";
import { useHeightVar } from "@/lib/use-height-var";
import { cn } from "@/lib/utils";
import {
  closeJoining,
  freshQr,
  GROUP_WORD,
  GROUP_WORD_LOWER,
  type GroupJoinTicket,
  type GroupMessageView,
  type GroupView,
  joinNames,
  memberLabel,
  sendGroupMessage,
} from "./group-api";
import { GroupGroundCards } from "./group-ground";
import { GroupQrPanel } from "./group-qr";
import { GroupSafetyBar } from "./group-safety";
import { readJoinTicket, saveJoinTicket } from "./join-ticket";
import { useGroup } from "./use-group";
import { GROUPS_MET_KEY } from "@/components/next-move/use-home-state";

interface Pending {
  id: string;
  text: string;
  at: number;
}

/** "Sun 3pm at Dice and Tea" for the pinned plan line. */
const planLine = (t: PlanTicket) => `${t.place.name}${t.when ? `, ${t.when}` : ""}`;

/**
 * One group chat (D25, D26). Larry opened it with the group's common ground; after that it speaks
 * only when tagged (the @Larry button, "@", or a /command). No read receipts, typing dots, online
 * status or unread counts. Every group ends at a door: the group Plan Ticket.
 */
export function GroupChat({ id }: { id: string }) {
  const router = useRouter();
  const { group, messages, apply, offline, gone } = useGroup(id);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [sendError, setSendError] = React.useState<string | null>(null);
  // Larry's answer for this person only (the /mood reply): never part of the group's messages.
  const [privateNote, setPrivateNote] = React.useState<string | null>(null);
  // Larry needed places and this phone has no location: the line it was for, to send again after a share.
  const [needsLocation, setNeedsLocation] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [ticket, setTicket] = React.useState<PlanTicket | null>(null);
  const [join, setJoin] = React.useState<GroupJoinTicket | null>(() => readJoinTicket(id));
  const [qrOpen, setQrOpen] = React.useState(true);
  const [closing, setClosing] = React.useState(false);
  const headerRef = React.useRef<HTMLElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  useHeightVar(headerRef, "--header-h", !!group);
  useHeightVar(composerRef, "--composer-h", !!group);

  const me = group?.members.find((m) => m.isMe);
  const others = group?.members.filter((m) => !m.isMe) ?? [];
  const seats: Seat[] = React.useMemo(() => (group?.members ?? []).map((m) => ({ id: m.id, name: m.name, color: m.color })), [group?.members]);
  const fitPeople: FitPeople = React.useMemo(
    () => Object.fromEntries((group?.members ?? []).map((m) => [m.id, { name: m.isMe ? "You" : m.name, color: m.color }])),
    [group?.members],
  );
  // The home card's step 3 moves on once this phone has met someone in a group, even when the
  // groups list can't be read. Counted once per group.
  const othersCount = others.length;
  React.useEffect(() => {
    if (!othersCount) return;
    try {
      const idsKey = `${GROUPS_MET_KEY}.ids`;
      const ids = JSON.parse(localStorage.getItem(idsKey) ?? "[]") as unknown;
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
      if (list.includes(id)) return;
      // The group just formed (someone else is in): one success haptic, once per group.
      success();
      localStorage.setItem(idsKey, JSON.stringify([...list, id].slice(-50)));
      const met = Number(JSON.parse(localStorage.getItem(GROUPS_MET_KEY) ?? "0")) || 0;
      localStorage.setItem(GROUPS_MET_KEY, JSON.stringify(met + 1));
    } catch {
      // Storage off: the signed-in groups list still covers it.
    }
  }, [othersCount, id]);
  const joiningOpen = !!group && group.joinOpenUntil > 0 && group.openSeats > 0;
  const showQr = !!group && !!me?.isCreator && joiningOpen && !!join;

  // New lines scroll into view (not on every poll: only when the count changes).
  const count = messages.length + pending.length;
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  if (gone) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <LarryMoment kind="empty" title={`This ${GROUP_WORD_LOWER} chat has closed for you.`} headingLevel={2}>
          <p className="text-ink-soft">That can happen when someone leaves or the {GROUP_WORD_LOWER} ends. Start a fresh one any time.</p>
          <LinkButton href="/group/new">Start a {GROUP_WORD_LOWER}</LinkButton>
        </LarryMoment>
      </main>
    );
  }
  if (!group) {
    return <LarryMoment kind="thinking" title={`Opening your ${GROUP_WORD_LOWER}`} className="mx-auto mt-16" />;
  }

  const send = async (text: string, tagsLarry: boolean) => {
    const p: Pending = { id: `p${Date.now()}`, text, at: Date.now() };
    setPending((list) => [...list, p]);
    setSendError(null);
    setPrivateNote(null);
    setNeedsLocation(null);
    try {
      const persona = tagsLarry ? loadPersona() : null;
      const out = await sendGroupMessage(id, text, tagsLarry, persona);
      apply(out);
      if (out.privateNote) setPrivateNote(out.privateNote);
      if (out.needsLocation) {
        setNeedsLocation(text);
        if (!out.privateNote) setPrivateNote("Share a rough spot (about 1 km, only I see it) and I can find real places near you.");
      }
      if (persona && out.personaUpdate && !isEmptyUpdate(out.personaUpdate)) savePersona(applyPersonaUpdate(persona, out.personaUpdate));
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setPending((list) => list.filter((x) => x.id !== p.id));
    }
  };

  /** The one-tap "Share location": the same request flow as the onboarding ask, then the line again. */
  const shareLocation = async () => {
    if (sharing || !needsLocation) return;
    const again = needsLocation;
    setSharing(true);
    const point = await requestLocation();
    setSharing(false);
    if (!point) {
      setNeedsLocation(null);
      setPrivateNote("Your browser said not now. You can allow location in your browser settings, then tag me again.");
      return;
    }
    // Only commands that need a place are sent again; a free question was already answered.
    const parsed = parseLarryCommand(again);
    if (parsed.kind === "command" && (parsed.cmd === "plan" || parsed.cmd === "matchday")) void send(again, true);
    else {
      setNeedsLocation(null);
      setPrivateNote("Thanks! Tag me again and I'll look near you.");
    }
  };

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      apply(await closeJoining(id));
      saveJoinTicket(id, null);
      setJoin(null);
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setClosing(false);
    }
  };

  const reopen = async () => {
    try {
      const out = await freshQr(id);
      apply(out);
      saveJoinTicket(id, out.join);
      setJoin(out.join);
      setQrOpen(true);
    } catch (err) {
      setSendError((err as Error).message);
    }
  };

  const title = others.length ? joinNames(others.map((m) => m.name)) : `Your ${GROUP_WORD_LOWER}`;
  const latestPlan = group.planTicket;

  return (
    <div className="flex flex-1 flex-col">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b-2 border-line bg-table px-3 py-2 sm:px-6" // Solid, no backdrop blur: a blur re-rasterises the header on every scroll frame of the chat on phones.
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <Link href="/group" aria-label={`All ${GROUP_WORD_LOWER}s`} className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-paper">
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-title-sm font-black leading-tight">{title}</h1>
              <p className="text-label text-ink-soft">
                {GROUP_WORD} of {group.size}
                {group.openSeats > 0 && joiningOpen ? `, ${group.openSeats} still to join` : ""}
                {others.some((m) => m.isDemoFriend) ? `, with ${others.length === 1 ? "a demo friend" : "demo friends"}` : ""}
              </p>
            </div>
            {me?.isCreator && joiningOpen && !showQr && (
              <Button size="sm" variant="secondary" icon={<QrCode />} onClick={reopen}>
                Show QR
              </Button>
            )}
          </div>
          <GroupSafetyBar
            group={group}
            onApplied={apply}
            onClosed={(why) => router.push(`/group?closed=${why}`)}
          />
        </div>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-3 pb-[calc(var(--composer-h,8rem)+1.5rem)] pt-4 sm:px-6">
        {showQr && join && (
          qrOpen ? (
            <GroupQrPanel group={group} join={join} onClose={close} closing={closing} onApplied={apply} />
          ) : (
            <Button variant="secondary" icon={<QrCode />} onClick={() => setQrOpen(true)} className="self-center">
              Show the QR again
            </Button>
          )
        )}

        {!group.opened && group.members.length < 2 && !showQr && (
          <p className="rounded-mini bg-paper p-3 text-center text-ink-soft">Waiting for someone to scan the QR.</p>
        )}

        <ol className="flex flex-col gap-3" aria-label="Messages">
          {messages.map((m, i) => (
            <li key={m.id}>
              <MessageRow message={m} group={group} seats={seats} prev={messages[i - 1]} onTicket={setTicket} />
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id}>
              <ChatBubble sender="person" name="You" initial={me?.name} seatColor={me?.color} align="end" avatar="hide-on-phone" toLarry={parseLarryCommand(p.text).kind !== "none"} footer="Sending…">
                {p.text}
              </ChatBubble>
            </li>
          ))}
        </ol>

        {group.larryBusy && <LarryMoment kind="thinking" layout="row" title={`${APP_NAME} is thinking`} />}
        {group.larryAway && (
          <p className="rounded-mini bg-paper p-3 text-label text-ink-soft">
            {APP_NAME} stepped out and isn&apos;t reading. Tag @{APP_NAME} and pick Hello to bring it back.
          </p>
        )}
        <div ref={bottomRef} />
      </main>

      <div ref={composerRef} className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-table px-3 pb-3 pt-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {/* The door out: the group's plan, pinned. Before there is one, one plain line says how. */}
          {latestPlan ? (
            <button
              type="button"
              onClick={() => setTicket(latestPlan)}
              className="press press-hard flex min-h-12 items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 text-left font-bold text-ink hover:bg-table"
            >
              <Ticket className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Your plan: {planLine(latestPlan)}</span>
            </button>
          ) : group.members.length >= 2 ? (
            <p className="flex items-center gap-2 px-2 text-label text-ink-soft">
              <LarryAvatar size="xs" decorative />
              Ready to get out? Tap @{APP_NAME} and pick Plan.
            </p>
          ) : null}
          {offline && (
            <p role="status" className="flex items-center gap-2 px-2 text-label font-bold text-ink">
              <WifiOff className="size-4" aria-hidden /> Reconnecting…
            </p>
          )}
          {privateNote && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
              <p role="status" className="flex min-w-0 flex-1 items-center gap-2 text-label text-ink-soft">
                <LarryAvatar size="xs" decorative />
                <span>
                  <span className="sr-only">Only you can see this. </span>
                  {privateNote}
                </span>
              </p>
              {needsLocation && (
                <Button size="sm" icon={<MapPin />} loading={sharing} onClick={shareLocation}>
                  Share location
                </Button>
              )}
            </div>
          )}
          {sendError && (
            <p role="alert" className="px-2 text-label font-bold text-danger">
              {sendError}
            </p>
          )}
          {/* Nobody to talk to yet: the QR is the whole job, so the composer waits for the first friend. */}
          {group.members.length >= 2 && (
            <PromptInputBox
              speakers={[{ name: me?.name ?? "You", color: me?.color ?? "var(--ink)" }]}
              activeSpeaker={0}
              onSpeakerChange={() => {}}
              onSend={(text, tagsLarry) => void send(text, tagsLarry)}
              larryBusy={group.larryBusy}
              larryMenu={{ group: true }}
            />
          )}
        </div>
      </div>

      <Dialog open={!!ticket} onOpenChange={(o) => !o && setTicket(null)} title="Your group plan" icon={<Ticket className="size-5" />}>
        {ticket && (
          <PlanTicketView
            key={ticket.place.id}
            ticket={ticket}
            people={fitPeople}
            withPerson={joinNames(others.map((m) => m.name))}
            ownerName={me?.name}
            variant="dialog"
            groupSize={group.members.length}
            whyHere={null}
            afterSave="close"
            location={readStoredLocation()}
            onDone={() => setTicket(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function MessageRow({
  message: m,
  group,
  seats,
  prev,
  onTicket,
}: {
  message: GroupMessageView;
  group: GroupView;
  seats: Seat[];
  prev?: GroupMessageView;
  onTicket: (t: PlanTicket) => void;
}) {
  if (m.kind === "system") {
    return <p className="text-center text-label text-ink-soft">{m.text}</p>;
  }
  const fromLarry = m.from === "larry" || m.kind === "opening" || m.kind === "larry" || m.kind === "care";
  const sameAsPrev = !!prev && prev.from === m.from && prev.kind !== "system";
  if (fromLarry) {
    return (
      <div className="flex flex-col gap-2.5">
        <ChatBubble sender="larry" showName={!sameAsPrev}>
          {m.text}
        </ChatBubble>
        {m.ground && (m.ground.bridges.length > 0 || m.ground.shared.length > 0) && (
          <div className="ml-11 max-w-xl sm:ml-12">
            <GroupGroundCards ground={m.ground} people={seats} />
          </div>
        )}
        {m.planTicket && (
          <div className="ml-11 sm:ml-12">
            <Button variant="primary" icon={<Ticket />} onClick={() => onTicket(m.planTicket!)}>
              See the plan: {m.planTicket.place.name}
            </Button>
          </div>
        )}
      </div>
    );
  }
  const member = group.members.find((x) => x.id === m.from);
  const mine = !!member?.isMe;
  const name = member ? (mine ? "You" : memberLabel(member)) : (m.name ?? "Someone who left");
  return (
    <ChatBubble
      sender="person"
      name={name}
      initial={member?.name ?? m.name}
      seatColor={member?.color}
      align={mine ? "end" : "start"}
      avatar={mine ? "hide-on-phone" : "show"}
      toLarry={parseLarryCommand(m.text).kind !== "none"}
      showName={!sameAsPrev}
      className={cn(sameAsPrev && "-mt-1.5")}
    >
      {m.text}
    </ChatBubble>
  );
}
