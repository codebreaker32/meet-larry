"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, Crown, Flag, LogOut, UserMinus, Users, UserX } from "lucide-react";
import { profileHref } from "@/components/profile/profile-view";
import { Button, Dialog } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  GROUP_REPORT_REASONS,
  GROUP_WORD,
  GROUP_WORD_LOWER,
  type GroupMemberView,
  type GroupReportReason,
  type GroupState,
  type GroupView,
  leaveGroup,
  memberAction,
  memberLabel,
} from "./group-api";

// One tap from every group chat header: Members, Leave, Unfriend, Block and Report (D26). All silent
// and immediate: nobody is told. Unfriend, Block and Report close your shared chats with them at once.

type Kind = "leave" | "unfriend" | "block" | "report" | "members";

const REASON_TEXT: Record<GroupReportReason, string> = {
  unkind: "Unkind or rude",
  unsafe: "Made me feel unsafe",
  spam: "Spam or selling something",
  underage: "Seems under 18",
  other: "Something else",
};

const ACTIONS: { kind: Exclude<Kind, "members">; label: string; Icon: typeof LogOut }[] = [
  { kind: "leave", label: "Leave", Icon: LogOut },
  { kind: "unfriend", label: "Unfriend", Icon: UserMinus },
  { kind: "block", label: "Block", Icon: Ban },
  { kind: "report", label: "Report", Icon: Flag },
];

/** A seat-colour initial tile: the colour is a marker, the name is always in words beside it. */
export function SeatTile({ member, className }: { member: Pick<GroupMemberView, "name" | "color">; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-8 shrink-0 place-items-center rounded-tile font-display text-caption font-black text-ink", className)}
      style={{ background: member.color }}
    >
      {member.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function GroupSafetyBar({
  group,
  onApplied,
  onClosed,
  className,
}: {
  group: GroupView;
  /** A remove answered with the fresh group. */
  onApplied: (state: Partial<GroupState>) => void;
  /** This phone is out of the chat now (left, or the only other person was unfriended or blocked). */
  onClosed: (why: "left" | "unfriend" | "block" | "report") => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [who, setWho] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<GroupReportReason | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const others = group.members.filter((m) => !m.isMe);
  const me = group.members.find((m) => m.isMe);
  const target = others.length === 1 ? others[0] : others.find((m) => m.id === who);

  const show = (kind: Kind) => {
    setWho(null);
    setReason(null);
    setError(null);
    setOpen(kind);
  };

  const run = async () => {
    if (busy || !open || open === "members") return;
    setError(null);
    if (open !== "leave" && !target) {
      setError("Pick who first.");
      return;
    }
    if (open === "report" && !reason) {
      setError("Pick what happened first.");
      return;
    }
    setBusy(true);
    try {
      if (open === "leave") {
        await leaveGroup(group.id);
        onClosed("left");
      } else {
        const out = await memberAction(group.id, open, target!.id, open === "report" ? reason! : undefined);
        // With only one other person, the chat is over for you; in a bigger group it carries on without them.
        if (others.length === 1) onClosed(open);
        else onApplied(out);
      }
      setOpen(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: GroupMemberView) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onApplied(await memberAction(group.id, "remove", m.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    leave: {
      title: `Leave this ${GROUP_WORD_LOWER}?`,
      text: "The chat closes on your phone. Nobody is told why.",
      go: "Leave",
    },
    unfriend: {
      title: target ? `Unfriend ${target.name}?` : "Unfriend someone",
      text: "They aren't told. Your shared chats with them close at once.",
      go: "Unfriend",
    },
    block: {
      title: target ? `Block ${target.name}?` : "Block someone",
      text: `They'll vanish from your ${APP_NAME} for good, no questions asked. They aren't told.`,
      go: "Block",
    },
    report: {
      title: target ? `Report ${target.name}?` : "Report someone",
      text: "Thanks for telling us. We look at the last messages, and they're blocked for you straight away.",
      go: "Report and block",
    },
  } as const;

  return (
    <>
      <div role="group" aria-label={`${GROUP_WORD} options`} className={cn("grid grid-cols-5 gap-1.5 sm:flex sm:flex-wrap", className)}>
        <button
          type="button"
          onClick={() => show("members")}
          className="press press-hard flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-tile border-2 border-ink bg-paper px-1 text-caption font-bold text-ink hover:bg-table sm:min-h-12 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-label"
        >
          <Users className="size-4" aria-hidden />
          Members
          <span className="sr-only">({group.members.length})</span>
        </button>
        {ACTIONS.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => show(kind)}
            // Unfriend, Block and Report need someone to be about.
            hidden={kind !== "leave" && others.length === 0}
            className="press press-soft flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-tile border-2 border-border-subtle bg-paper px-1 text-caption font-bold text-ink hover:border-border-control sm:min-h-12 sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-3 sm:text-label"
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <Dialog
        open={open === "members"}
        onOpenChange={(o) => !o && setOpen(null)}
        title={`Who's here (${group.members.length} of ${group.size})`}
        icon={<Users className="size-5" />}
        size="sm"
      >
        <ul className="flex flex-col gap-2">
          {group.members.map((m) => (
            <li key={m.id} className="flex min-h-12 items-center gap-3">
              <SeatTile member={m} />
              <span className="min-w-0 flex-1">
                {m.isMe || !m.username || m.isDemoFriend ? (
                  <span className="font-bold">{m.isMe ? `${m.name} (you)` : memberLabel(m)}</span>
                ) : (
                  <Link
                    href={profileHref(m.username)}
                    className="inline-flex min-h-12 items-center font-bold underline decoration-2 underline-offset-4 hover:decoration-ink"
                  >
                    {m.name}
                  </Link>
                )}
                {m.isCreator && (
                  <span className="ml-2 inline-flex items-center gap-1 text-label text-ink-soft">
                    <Crown className="size-3.5" aria-hidden /> started it
                  </span>
                )}
              </span>
              {me?.isCreator && !m.isMe && (
                <Button size="sm" variant="secondary" icon={<UserX />} loading={busy} onClick={() => remove(m)}>
                  Remove<span className="sr-only"> {m.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-label text-ink-soft">
          Members see each other&apos;s first name and taste card. Never a phone number.
        </p>
        {error && (
          <p role="alert" className="mt-2 font-bold text-danger">
            {error}
          </p>
        )}
      </Dialog>

      {open && open !== "members" && (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={copy[open].title}
          description={copy[open].text}
          size="sm"
        >
          <div className="flex flex-col gap-3">
            {open !== "leave" && others.length > 1 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 font-bold">Who?</legend>
                {others.map((m) => (
                  <label key={m.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-tile px-2 hover:bg-table">
                    <input type="radio" name="who" className="size-5 accent-ink" checked={who === m.id} onChange={() => setWho(m.id)} />
                    <SeatTile member={m} />
                    <span className="font-bold">{memberLabel(m)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {open === "report" && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 font-bold">What happened?</legend>
                {GROUP_REPORT_REASONS.map((r) => (
                  <label key={r} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-tile px-2 hover:bg-table">
                    <input type="radio" name="reason" className="size-5 accent-ink" checked={reason === r} onChange={() => setReason(r)} />
                    {REASON_TEXT[r]}
                  </label>
                ))}
              </fieldset>
            )}
            {error && (
              <p role="alert" className="font-bold text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button loading={busy} onClick={run}>
                {copy[open].go}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                {open === "leave" ? "Stay" : "Not now"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
