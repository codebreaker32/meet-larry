"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Flag, MessageCircleQuestion, Moon, UserPlus } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { StepKindPill } from "@/components/step-kind";
import { APP_NAME } from "@/lib/brand";
import type { GroupMember } from "@/lib/contracts";
import type { StepKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const FADE_TEXT = "You all seem fine without me. I'll be here if you need me.";

/** What Larry just did for the group, shown under its bubble so the move is visible. */
export type LarryMove = { kind: "invite" | "ask"; member: GroupMember; isMe: boolean };

/** "Inviting Priya in": Larry turning to the person who has said the least. Goes in ChatBubble's footer. */
export function MoveTag({ move }: { move: LarryMove }) {
  const who = move.isMe ? "you" : move.member.name;
  const Icon = move.kind === "invite" ? UserPlus : MessageCircleQuestion;
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-label font-bold text-ink">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: move.member.color }} />
      <Icon className="size-4 shrink-0" aria-hidden />
      {move.kind === "invite" ? `${APP_NAME} is inviting ${who} in` : `${APP_NAME} asked ${who}`}
    </p>
  );
}

/** A room event between messages: "Priya joined." */
export function RoomEvent({ text, color }: { text: string; color?: string }) {
  return (
    <p className="mx-auto flex items-center gap-2 rounded-full bg-paper px-3 py-1 text-label text-ink-soft ring-2 ring-line">
      {color && <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />}
      {text}
    </p>
  );
}

export function TypingRow({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 pl-11 text-ink-soft">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 rounded-full bg-ink motion-safe:animate-[typing_1.2s_ease-in-out_infinite]"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      <span>{text}</span>
    </p>
  );
}

export function FadeChip({ onWake }: { onWake: () => void }) {
  return (
    <div className="mx-auto mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-bubble bg-paper px-4 py-2 ring-2 ring-border-subtle">
      <p className="flex items-center gap-2 font-bold text-ink">
        <Moon className="size-4 shrink-0" aria-hidden /> {FADE_TEXT}
      </p>
      <button type="button" onClick={onWake} className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}>
        Need {APP_NAME}?
      </button>
    </div>
  );
}

/**
 * A First Step Larry picked for the whole group: a card on the table with who it is for, and a
 * button that saves it to this phone's First Steps. Coral ring once saved.
 */
export function GroupStepCard({
  kind,
  text,
  forNames,
  saved,
  onSave,
}: {
  kind: StepKind;
  text: string;
  forNames: string;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-mini border-2 bg-paper p-3 shadow-mini sm:ml-11",
        saved ? "border-cat-film ring-2 ring-cat-film" : "border-ink",
      )}
    >
      <p className="flex items-center gap-2 text-label font-bold text-ink">
        <Flag className="size-4 shrink-0" aria-hidden /> Group First Step from {APP_NAME}
      </p>
      <div className="mt-2 flex items-start gap-2">
        <StepKindPill kind={kind} />
        <p className="pt-1 text-lead font-bold leading-snug">{text}</p>
      </div>
      <p className="mt-1.5 text-label text-ink-soft">With {forNames}.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {saved ? (
          <>
            <p className="flex min-h-12 items-center gap-2 font-bold">
              <Check className="size-5" aria-hidden /> Saved on this phone
            </p>
            <Link href="/steps" className={buttonStyles.quiet}>
              See my First Steps
            </Link>
          </>
        ) : (
          <button type="button" onClick={onSave} className={cn(buttonStyles.primary, "min-h-12")}>
            Save to my First Steps
          </button>
        )}
      </div>
    </article>
  );
}
