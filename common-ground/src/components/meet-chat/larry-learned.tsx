"use client";

import * as React from "react";
import { Sparkles, X } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import type { Persona, PersonaUpdate } from "@/lib/contracts";
import {
  applyPersonaUpdate,
  describePersonaUpdate,
  isEmptyUpdate,
  loadPersona,
  savePersona,
  undoPersonaUpdate,
  usePersona,
} from "@/lib/persona";
import { cn } from "@/lib/utils";

interface Learned {
  lines: string[];
  update: PersonaUpdate;
  before: Persona;
}

/**
 * Larry's picture of this phone's person, and what it learned in this chat. `learn` merges a
 * PersonaUpdate from a chat reply into the saved persona (on this phone only) and keeps a note
 * with an Undo, so nothing is learned behind the person's back.
 */
export function usePersonaLearning() {
  const persona = usePersona();
  const [note, setNoteState] = React.useState<Learned | null>(null);
  // Read by callbacks, so Undo never acts twice or on an old note.
  const noteRef = React.useRef<Learned | null>(null);
  const setNote = React.useCallback((n: Learned | null) => {
    noteRef.current = n;
    setNoteState(n);
  }, []);

  const learn = React.useCallback((u: PersonaUpdate | undefined | null) => {
    if (!u || isEmptyUpdate(u)) return;
    const before = loadPersona();
    if (!before) return;
    const lines = describePersonaUpdate(u);
    savePersona(applyPersonaUpdate(before, u));
    if (lines.length) setNote({ lines, update: u, before });
  }, [setNote]);

  const undo = React.useCallback(() => {
    const n = noteRef.current;
    const current = loadPersona();
    if (n && current) savePersona(undoPersonaUpdate(current, n.update, n.before));
    setNote(null);
  }, [setNote]);

  const dismiss = React.useCallback(() => setNote(null), [setNote]);
  return { persona, note, learn, undo, dismiss };
}

/** "Larry learned: You like Stardew Valley." A small paper note with Undo, inside the chat. */
export function LearnedNote({
  note,
  onUndo,
  onDismiss,
  className,
}: {
  note: Learned;
  onUndo: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-bubble bg-paper px-3 py-2 ring-2 ring-line", className)}>
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-label leading-snug text-ink">
        <span className="font-bold">{APP_NAME} learned: </span>
        {note.lines.slice(0, 3).join(" ")}
        <span className="block text-ink-soft">Saved to your taste on this phone.</span>
      </p>
      <button type="button" onClick={onUndo} className="press press-flat min-h-12 rounded-full px-3 text-label font-bold underline decoration-2 underline-offset-4 hover:bg-table">
        Undo
      </button>
      <button type="button" onClick={onDismiss} aria-label="Close note" className="press press-flat grid size-12 place-items-center rounded-full hover:bg-table">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
