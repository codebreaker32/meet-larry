"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { BridgeCard, type Seat } from "@/components/bridge-card";
import { Poster } from "@/components/taste-card";
import type { GroupGround } from "@/lib/contracts";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import { joinNames } from "./group-api";

/** Bridges shown before "Show more": Larry already curated and ordered them, best first. */
const SHOWN = 3;

/**
 * The group's common ground inside Larry's message: the Qloo bridges Larry kept (or, when there
 * are none, what two or more of them picked) (best first), each with its reason lines and "Why this?" naming whose picks led
 * there. Never a model guess: every card comes from Qloo's taste graph.
 */
export function GroupGroundCards({ ground, people }: { ground: GroupGround; people: Seat[] }) {
  const [all, setAll] = React.useState(false);
  const bridges = all ? ground.bridges : ground.bridges.slice(0, SHOWN);
  const name = (id: string) => people.find((p) => p.id === id)?.name;
  const listId = React.useId();

  return (
    <div className="flex flex-col gap-2.5">
      {/* With bridges, the cards are the bridges (Larry's text already names one shared pick).
          Shared picks show as cards only when Qloo found no bridge. */}
      {ground.bridges.length === 0 && ground.shared.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={people.length > 2 ? "You all picked" : "You both picked"}>
          {ground.shared.slice(0, 3).map(({ item, memberIds }) => {
            const style = DOMAIN_STYLE[item.domain];
            const names = memberIds.map(name).filter((n): n is string => !!n);
            return (
              <li key={item.id} className="flex items-center gap-3 rounded-mini border-(length:--border-frame) bg-paper p-2" style={{ borderColor: style.color }}>
                <Poster item={item} className="h-14 w-10 shrink-0" sizes="48px" />
                <p className="min-w-0 text-label leading-snug text-ink">
                  <span className="block font-display text-body font-black">{item.name}</span>
                  {names.length > 1 ? `${joinNames(names)} ${names.length > 2 ? "all" : "both"} picked this.` : "On more than one card."}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <ul id={listId} className="flex flex-col gap-2.5">
        {bridges.map((b, i) => (
          <li key={b.id}>
            <BridgeCard bridge={b} people={people} best={i === 0 && !!ground.curated} />
          </li>
        ))}
      </ul>
      {ground.bridges.length > SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((v) => !v)}
          className="press press-flat flex min-h-12 items-center gap-1 self-start rounded-full px-3 font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-table"
        >
          {all ? "Show fewer" : `Show ${ground.bridges.length - SHOWN} more`}
          <ChevronDown className={all ? "size-4 rotate-180" : "size-4"} aria-hidden />
        </button>
      )}
    </div>
  );
}
