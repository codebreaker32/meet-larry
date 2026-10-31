"use client";

// Based on the "AI prompt box" component the user supplied: same PromptInput context,
// autosizing textarea, action row, tooltip actions and mic-to-send button.
// Changes for this app:
// - No style injection at import time (it touched `document` and broke server rendering);
//   scrollbar styles live in globals.css.
// - The mic does real speech-to-text into the text box instead of sending a
//   "[Voice message]" placeholder.
// - Search / Think / Canvas toggles, image upload and the image dialog are removed.
// - Added: a "who's talking" toggle for two people on one phone, one-tap replies between the
//   two people, a separate group of questions for Larry, and an "Ask Larry" / "Just us" switch.
// - Single-speaker mode (rooms on each person's own phone, and solo chat): with one speaker the
//   "Who is talking?" row is hidden; `placeholder`, `repliesLabel` and `repliesHighlight` let a
//   room say "Larry asked you", and `larryBusy` blocks only messages to Larry, so people can keep
//   talking "Just us" while Larry replies to someone else.
// - Restyled for the light card-table theme. `motion` is framer-motion's current package.
// - One action button stays mounted and morphs between mic, stop and send, so keyboard
//   focus is never dropped; while Larry replies it is aria-disabled rather than disabled.
// - "Excuse Larry" / "Hello Larry": while Larry is excused (`away`) a slim banner says so the
//   whole time, every message goes to the people only, and Larry's questions are hidden. When
//   Larry comes back a short "Larry's back" note shows for a few seconds.
//   Tapping either moves keyboard focus to the other one, which replaces it.
// - `larryMenu` (group chats, D21/D25): no "Ask Larry" switch and no command chips. One @Larry button
//   sits in the composer; tapping it, or typing "@" or "/" at the start, pops up Larry's command menu
//   (src/lib/larry-commands.ts) as a listbox: arrow keys, Enter, Escape (focus goes back to where it
//   was). Tapping @Larry also puts an "@Larry" chip at the start of the message; it stays when the
//   menu closes, so a free question can follow, and its x (or Backspace at the start) removes it.
//   Picking a command sends it. A message reaches Larry only when it tags Larry ("@Larry ..." or
//   a /command); everything else is for the people. The mic stays for anyone who can't type.
// - `justUsNote`: a one-time note the first time someone on this device taps "Just us".

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  CircleHelp,
  DoorOpen,
  EyeOff,
  Gem,
  Hand,
  Handshake,
  LogOut,
  type LucideIcon,
  Mic,
  Smile,
  Square,
  Ticket,
  TrendingUp,
  Tv,
  Users,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LarryAvatar } from "@/components/larry-avatar";
import { chipStyles } from "./chip";
import { APP_NAME } from "@/lib/brand";
import { MESSAGE_MAX } from "@/lib/chat-protocol";
import { looksLikeCrisis } from "@/lib/crisis";
import { commandText, filterLarryCommands, type LarryCommand, type LarryCommandIcon, parseLarryCommand } from "@/lib/larry-commands";
import { SPEECH_HONESTY, SPEECH_LANGS, SPEECH_UNSUPPORTED, useSpeechToText } from "@/lib/use-speech";
import { DURATION, EASE_DEAL } from "@/lib/tokens";
import { cn } from "@/lib/utils";

// Tooltip

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      // A floating overlay, so it may cast a shadow.
      className={cn("z-50 rounded-tile bg-ink px-3 py-1.5 text-label font-bold text-paper shadow-mini", className)} // taste-skill-ignore
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

// PromptInput context

interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number;
  onSubmit?: () => void;
  disabled?: boolean;
  /** Runs first on every key in the text box; return true when it handled the key (the command menu). */
  onKey?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Combobox wiring while the command menu is open from typing. */
  comboProps?: React.AriaAttributes & { role?: string };
  textareaRef?: React.Ref<HTMLTextAreaElement>;
}

const PromptInputContext = React.createContext<PromptInputContextType | null>(null);

function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInput");
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  maxHeight?: number;
  onSubmit?: () => void;
  disabled?: boolean;
  onKey?: PromptInputContextType["onKey"];
  comboProps?: PromptInputContextType["comboProps"];
  textareaRef?: PromptInputContextType["textareaRef"];
  className?: string;
  children: React.ReactNode;
}

function PromptInput({
  isLoading = false,
  value,
  onValueChange,
  maxHeight = 160,
  onSubmit,
  disabled = false,
  onKey,
  comboProps,
  textareaRef,
  className,
  children,
}: PromptInputProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <PromptInputContext.Provider
        value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit, disabled, onKey, comboProps, textareaRef }}
      >
        <div
          className={cn(
            "rounded-panel border-2 border-ink bg-paper p-2 shadow-panel",
            // The textarea's focus ring is drawn on the whole composer, so it follows the rounded edge.
            // The ring is an outline, not motion, so it shows under reduced motion too; the lift and
            // its shadows are extras on top, and the lift is dropped when motion is reduced.
            "has-[textarea:focus-visible]:outline-3 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-focus-ring",
            "transition-[transform,box-shadow] duration-(--dur-quick) ease-out has-[textarea:focus-visible]:-translate-y-1.5 has-[textarea:focus-visible]:shadow-lift motion-reduce:has-[textarea:focus-visible]:translate-y-0", // taste-skill-ignore: the composer floats over the page (fixed bar), so its lift on focus may cast a shadow.
            className,
          )}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipPrimitive.Provider>
  );
}

function PromptInputTextarea({ placeholder, label }: { placeholder?: string; label: string }) {
  const { value, setValue, maxHeight, onSubmit, disabled, onKey, comboProps, textareaRef } = usePromptInput();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const id = React.useId();
  React.useImperativeHandle(textareaRef, () => ref.current as HTMLTextAreaElement);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={value}
        maxLength={MESSAGE_MAX}
        disabled={disabled}
        placeholder={placeholder}
        {...comboProps}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (onKey?.(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        className="min-h-12 w-full flex-1 resize-none bg-transparent px-3 py-3 text-body text-ink placeholder:text-ink-soft focus:outline-none disabled:cursor-not-allowed disabled:text-ink-soft"
      />
    </>
  );
}

function PromptInputAction({ tooltip, children }: { tooltip: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </TooltipPrimitive.Root>
  );
}

// Main component

export interface Speaker {
  name: string;
  color: string;
}

/** Who hears what is sent: Larry (the AI is called) or only the other person (no AI call). */
export type ComposerMode = "larry" | "us";

interface PromptInputBoxProps {
  speakers: Speaker[];
  activeSpeaker: number;
  onSpeakerChange: (index: number) => void;
  /** `toLarry` is false for "Just us" messages. */
  onSend: (message: string, toLarry: boolean) => void;
  /** One-tap replies, said by the selected speaker to `replyTo`, under "<speaker>'s replies". */
  replies?: string[];
  /** Who the replies and "Just us" messages are for. */
  replyTo?: string;
  /** Questions for Larry, in their own group. Tapping one always asks Larry. */
  larryQuestions?: string[];
  /** The "Ask Larry" / "Just us" switch. Left out (practice), everything goes to the chat partner. */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  isLoading?: boolean;
  disabled?: boolean;
  /** Larry is replying (rooms): only messages to Larry wait; "Just us" messages still send. */
  larryBusy?: boolean;
  /** Replaces the default placeholder (single-speaker mode). */
  placeholder?: string;
  /** Replaces the "<speaker>'s replies" heading, e.g. "Larry asked you. Tap to answer." */
  repliesLabel?: string;
  /** Frames the one-tap replies in ink: someone (Larry) is waiting for this person's answer. */
  repliesHighlight?: boolean;
  /** Larry is excused: it can't see the chat, and every message goes to the people only. */
  away?: boolean;
  /** Shows "Excuse Larry" (and "Hello Larry" while away). Needs `mode`. */
  onAwayChange?: (away: boolean) => void;
  /** Shown once per device, the first time someone taps "Just us". */
  justUsNote?: string;
  /**
   * Called whenever the person types or the mic hears words (R4): typing or speaking counts as
   * talking, so the page can reset its quiet-time fade.
   */
  onActivity?: () => void;
  /**
   * Group chats: the @Larry button and Larry's command menu instead of the "Ask Larry" switch.
   * `group` keeps group-only commands (Common ground) in the menu. Leave `mode` out with it.
   */
  larryMenu?: { group?: boolean };
  className?: string;
}

const COMMAND_ICONS: Record<LarryCommandIcon, LucideIcon> = {
  Ticket,
  Handshake,
  Gem,
  Users,
  TrendingUp,
  Tv,
  Smile,
  DoorOpen,
  Hand,
  CircleHelp,
};

/** True while the box holds only "@..." or "/..." (the command word being typed): the menu shows. */
const typingCommand = (text: string) => /^[@/][^\s]*$/.test(text) || /^@larry\s+[^\s]*$/i.test(text);

/**
 * Larry's command menu: a listbox above the composer. Options are real buttons-in-a-list for touch,
 * and the list follows aria-activedescendant for keyboards (the text box or the list keeps focus).
 */
function LarryCommandMenu({
  id,
  commands,
  active,
  onActive,
  onPick,
  listRef,
  focusable,
  onListKey,
  onLeave,
}: {
  id: string;
  commands: LarryCommand[];
  active: number;
  onActive: (i: number) => void;
  onPick: (c: LarryCommand) => void;
  listRef: React.Ref<HTMLUListElement>;
  /** Opened from the @Larry button: the list itself takes focus. */
  focusable: boolean;
  onListKey: (e: React.KeyboardEvent) => void;
  /** Focus left the list (a tap elsewhere): close it. */
  onLeave: (to: Element | null) => void;
}) {
  const optionId = (i: number) => `${id}-opt-${i}`;
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2">
      {/* A floating overlay, so it may cast a shadow. */}
      <ul
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={`Ask ${APP_NAME}`}
        tabIndex={focusable ? 0 : -1}
        aria-activedescendant={commands.length ? optionId(active) : undefined}
        onKeyDown={onListKey}
        onBlur={(e) => onLeave(e.relatedTarget as Element | null)}
        className="max-h-[min(24rem,55dvh)] overflow-y-auto rounded-panel border-2 border-ink bg-paper p-1.5 shadow-panel focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {commands.length === 0 && (
          <li role="presentation" className="px-3 py-3 text-body text-ink-soft">
            No command with that name. Type @{APP_NAME} and your question instead.
          </li>
        )}
        {commands.map((c, i) => {
          const Icon = COMMAND_ICONS[c.icon];
          return (
            <li
              key={c.cmd}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onPointerMove={() => onActive(i)}
              // mousedown, not click: the text box keeps focus, so the keyboard never jumps.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c)}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-tile px-3 py-1.5",
                i === active ? "bg-ink text-paper" : "text-ink hover:bg-table",
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="font-bold leading-tight">{c.label}</span>
                <span className={cn("text-label leading-snug", i === active ? "text-paper-soft" : "text-ink-soft")}>{c.hint}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Banner words, shared with the pages so screen-reader announcements match. */
export const AWAY_TEXT = `${APP_NAME} stepped out. It can't see this chat.`;
export const BACK_TEXT = `${APP_NAME}'s back. Ask away!`;
/** How long "Larry's back" stays. */
const BACK_MS = 4000;
/** How long the one-time "Just us" note stays unless closed first. */
const NOTE_MS = 7000;
/** How long after tapping Excuse or Hello focus may still follow the change (rooms round-trip). */
const FOCUS_MS = 10000;
const JUST_US_NOTE_KEY = "larry.note.just-us";

/** True the first time on this device (and remembers it); false after that, or without storage. */
function firstTimeJustUs(): boolean {
  try {
    if (localStorage.getItem(JUST_US_NOTE_KEY)) return false;
    localStorage.setItem(JUST_US_NOTE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** A short note floating just above the composer (it never pushes the chat around). */
function FloatingNote({ show, children }: { show: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    // Always mounted, so what appears in it is read out.
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 flex justify-center px-1">
      <AnimatePresence>
        {show && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 8 }}
            transition={{ duration: DURATION.base, ease: EASE_DEAL }}
            // A floating overlay, so it may cast a shadow.
            // Only its button takes taps, so the note never blocks the chat behind it.
            className="flex max-w-full items-center gap-2 rounded-bubble border-2 border-ink bg-paper py-1.5 pl-2 pr-1.5 text-label font-bold text-ink shadow-panel"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PromptInputBox({
  speakers,
  activeSpeaker,
  onSpeakerChange,
  onSend,
  replies = [],
  replyTo,
  larryQuestions = [],
  mode,
  onModeChange,
  isLoading = false,
  disabled = false,
  larryBusy = false,
  placeholder: placeholderOverride,
  repliesLabel,
  repliesHighlight = false,
  away = false,
  onAwayChange,
  justUsNote,
  onActivity,
  larryMenu,
  className,
}: PromptInputBoxProps) {
  const [input, setInputState] = React.useState("");
  /**
   * Group chats: the @Larry tag sits as a chip at the start of the message once the @Larry button is
   * tapped. It stays when the menu closes (a tap in the text box, Escape, a tap outside), so the
   * person can type a free question; only its x, Backspace at the start, or a send removes it.
   */
  const [tagged, setTagged] = React.useState(false);
  const onActivityRef = React.useRef(onActivity);
  React.useEffect(() => {
    onActivityRef.current = onActivity;
  });
  /** Every change to the words (typed, pasted or heard) counts as activity; clearing after a send does not. */
  const setInput = React.useCallback((text: string) => {
    setInputState(text);
    if (text) onActivityRef.current?.();
  }, []);
  // "Larry's back" for a few seconds after Larry returns (seen here, whoever said hello).
  const [prevAway, setPrevAway] = React.useState(away);
  const [backShown, setBackShown] = React.useState(0);
  if (prevAway !== away) {
    setPrevAway(away);
    setBackShown(away ? 0 : (n) => n + 1);
  }
  React.useEffect(() => {
    if (!backShown) return;
    const t = setTimeout(() => setBackShown(0), BACK_MS);
    return () => clearTimeout(t);
  }, [backShown]);
  const [noteShown, setNoteShown] = React.useState(false);
  React.useEffect(() => {
    if (!noteShown) return;
    const t = setTimeout(() => setNoteShown(false), NOTE_MS);
    return () => clearTimeout(t);
  }, [noteShown]);
  // Tapping Excuse or Hello unmounts the button that had focus, so focus moves on purpose to the
  // button that replaces it. Only for a change started on this device: another phone in the room
  // saying hello never pulls focus here.
  const helloRef = React.useRef<HTMLButtonElement>(null);
  const excuseRef = React.useRef<HTMLButtonElement>(null);
  const focusAfter = React.useRef<{ at: number } | null>(null);
  const changeAway = (next: boolean) => {
    focusAfter.current = { at: Date.now() };
    onAwayChange?.(next);
  };
  React.useEffect(() => {
    const tap = focusAfter.current;
    // Rooms round-trip to the server (and roll back if it fails), so a tap counts for a few
    // seconds. Focus only moves when it was dropped, never away from something chosen since.
    if (!tap || Date.now() - tap.at > FOCUS_MS) {
      focusAfter.current = null;
      return;
    }
    const dropped = !document.activeElement || document.activeElement === document.body;
    if (dropped) (away ? helloRef : excuseRef).current?.focus();
  }, [away]);
  const [questionsOpen, setQuestionsOpen] = React.useState(false);
  const speech = useSpeechToText((text) => setInput(text.slice(0, MESSAGE_MAX)));
  const speaker = speakers[activeSpeaker];
  const busy = isLoading || disabled;
  const hasContent = input.trim() !== "";
  const labelId = React.useId();
  const questionsId = React.useId();
  const isTagged = !!larryMenu && tagged;
  /** The words with the @Larry chip in front (unless they already tag Larry or are a /command). */
  const withTag = (text: string) => (isTagged && !/^\s*(@larry\b|\/)/i.test(text) ? `@${APP_NAME} ${text.trimStart()}` : text);
  const toLarry = larryMenu ? isTagged || parseLarryCommand(input).kind !== "none" : mode !== "us" && !away;
  /** Whether these words go to Larry: in a group only when they tag Larry. */
  const larryFor = (text: string) => (larryMenu ? parseLarryCommand(withTag(text)).kind !== "none" : toLarry);
  /**
   * Whether a message to Larry (or to the chat partner when there is no switch) has to wait. Words
   * that may mean a crisis never wait for Larry: they get the fixed help reply, with no Larry run.
   */
  const blocked = (larry: boolean, text?: string) => busy || (larry && larryBusy && !(text && looksLikeCrisis(text)));
  const sendBusy = blocked(toLarry);
  const typedBusy = blocked(toLarry, input);
  const showQuestions = !!mode && toLarry && larryQuestions.length > 0;
  // Very short replies sit four to a row. Up to 12 characters: two by two on narrow phones (so
  // "Tell me more" stays on one line), four to a row when there is room. Longer ones wrap as chips.
  const tinyReplies = replies.every((r) => r.length <= 7);
  const shortReplies = replies.every((r) => r.length <= 12);

  const submit = (text = input, larry = larryFor(text)) => {
    if (!text.trim()) return;
    const trimmed = withTag(text).trim().slice(0, MESSAGE_MAX);
    if (blocked(larry, trimmed)) return;
    // Drop any late speech result so the sent text doesn't come back into the box.
    speech.cancel();
    onSend(trimmed, larry);
    setInput("");
    setTagged(false);
  };

  const sendLabel = isLoading || (toLarry && larryBusy && typedBusy)
    ? "Wait for the reply"
    : larryMenu
      ? toLarry
        ? `Send to ${APP_NAME}`
        : "Send"
      : !mode || (away && !replyTo)
      ? "Send"
      : toLarry
        ? `Send to ${APP_NAME}`
        : `Send to ${replyTo ?? "them"}`;
  // One button, three jobs. Listening always shows Stop, even once words arrive.
  const actionMode: "stop" | "send" | "mic" = speech.listening ? "stop" : hasContent || !speech.supported ? "send" : "mic";
  const action = {
    stop: { label: "Stop listening", run: () => speech.stop() },
    send: { label: sendLabel, run: () => submit() },
    mic: { label: "Speak instead of typing", run: () => speech.start(input) },
  }[actionMode];
  const actionBlocked = actionMode === "send" ? !hasContent || typedBusy : actionMode === "mic" ? busy : false;

  const placeholder = placeholderOverride ?? (larryMenu
    ? isTagged
      ? `Ask ${APP_NAME} anything…`
      : `Message, or tag @${APP_NAME}…`
    : !mode || toLarry
    ? speech.supported
      ? `${speaker?.name}, type or tap the mic…`
      : `${speaker?.name}, type here…`
    : `${speaker?.name}, write to ${replyTo ?? "them"}…`);

  // ---- Larry's command menu (group chats) ----
  const menuId = React.useId();
  const [menuFrom, setMenuFrom] = React.useState<"button" | null>(null);
  const [menuDismissed, setMenuDismissed] = React.useState<string | null>(null);
  const [activeCmd, setActiveCmd] = React.useState(0);
  const atButtonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const typedMenu = !!larryMenu && typingCommand(input) && menuDismissed !== input;
  const menuOpen = !!larryMenu && (menuFrom === "button" || typedMenu);
  const commands = React.useMemo(
    () => (larryMenu ? filterLarryCommands(menuFrom === "button" ? "" : input, { group: larryMenu.group !== false }) : []),
    [larryMenu, menuFrom, input],
  );
  const active = Math.min(activeCmd, Math.max(0, commands.length - 1));
  React.useEffect(() => {
    if (menuFrom === "button") listRef.current?.focus();
  }, [menuFrom]);
  const closeMenu = (focusBack: boolean) => {
    const fromButton = menuFrom === "button";
    setMenuFrom(null);
    setMenuDismissed(input);
    setActiveCmd(0);
    if (focusBack) (fromButton ? atButtonRef : textRef).current?.focus();
  };
  const pick = (c: LarryCommand) => {
    const fromButton = menuFrom === "button";
    setMenuFrom(null);
    setActiveCmd(0);
    // Anything typed after the command word ("/plan saturday") rides along; from the button, the
    // words already in the box ride along, so nothing typed is lost.
    const args = fromButton
      ? input.replace(/^\s*@larry\b[\s,:;.!-]*/i, "")
      : input.replace(/^@larry\s+/i, "").replace(/^[@/]\S*\s*/, "");
    submit(commandText(c.cmd, args), true);
    (fromButton ? atButtonRef : textRef).current?.focus();
  };
  /** Arrow keys, Home/End, Enter and Escape: shared by the text box and the list. */
  const menuKey = (e: React.KeyboardEvent): boolean => {
    if (!menuOpen) return false;
    const n = commands.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActiveCmd((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      return true;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActiveCmd(e.key === "Home" ? 0 : Math.max(0, n - 1));
      return true;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (!n) return false;
      e.preventDefault();
      pick(commands[active]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return true;
    }
    return false;
  };

  /** The text box: the menu keys first, then Backspace at the very start removes the @Larry chip. */
  const composerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (menuKey(e)) return true;
    const el = e.currentTarget;
    if (isTagged && e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      setTagged(false);
      return true;
    }
    return false;
  };
  /** The @Larry button: puts the tag on the message and opens the menu (or closes an open menu). */
  const tapAtLarry = () => {
    if (menuFrom === "button") return closeMenu(true);
    setTagged(true);
    setActiveCmd(0);
    setMenuFrom("button");
  };
  const removeTag = () => {
    setTagged(false);
    setMenuFrom(null);
    setActiveCmd(0);
    textRef.current?.focus();
  };

  const chooseJustUs = () => {
    if (mode !== "us" && justUsNote && firstTimeJustUs()) {
      // The one-time note matters more than "Larry's back", which would otherwise hide it.
      setBackShown(0);
      setNoteShown(true);
    }
    onModeChange?.("us");
  };

  return (
    <div className={cn("relative flex w-full flex-col gap-2", className)}>
      {/* Above the composer: "Larry's back" after a hello, and the one-time "Just us" note. */}
      <FloatingNote show={!away && backShown > 0}>
        <LarryAvatar size="sm" decorative />
        <span className="py-1.5 pr-2">{BACK_TEXT}</span>
      </FloatingNote>
      <FloatingNote show={!away && !backShown && noteShown && !!justUsNote}>
        <Users className="ml-1 size-5 shrink-0" aria-hidden />
        <span className="py-1">{justUsNote}</span>
        <button
          type="button"
          onClick={() => setNoteShown(false)}
          className="pointer-events-auto min-h-12 shrink-0 rounded-full px-3 underline decoration-2 underline-offset-4 hover:bg-table"
        >
          Got it
        </button>
      </FloatingNote>
      {/* Read out when Larry is excused (here or on another phone in a room). */}
      <p role="status" className="sr-only">
        {away ? `${AWAY_TEXT}${onAwayChange ? ` Tap Hello ${APP_NAME} to bring it back.` : ""}` : ""}
      </p>
      {larryMenu && (
        <p role="status" className="sr-only">
          {isTagged ? `@${APP_NAME} tagged. Your message goes to ${APP_NAME}.` : ""}
        </p>
      )}

      {mode && away && (
        // Excused: a slim banner the whole time, with the one way back.
        <div className="flex items-center gap-2 rounded-bubble bg-ink py-1 pl-3 pr-1 text-paper">
          <EyeOff className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-label font-bold leading-snug">{AWAY_TEXT}</p>
          {onAwayChange && (
            <button
              ref={helloRef}
              type="button"
              onClick={() => changeAway(false)}
              className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-full bg-paper px-3 text-label font-bold text-ink transition-colors hover:bg-table sm:px-4"
            >
              <Hand className="size-4 sm:size-5" aria-hidden />
              Hello {APP_NAME}
            </button>
          )}
        </div>
      )}

      {mode && !away && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div role="group" aria-label="Who hears your message?" className="flex gap-1.5 sm:gap-2">
            <button
              type="button"
              aria-pressed={toLarry}
              onClick={() => onModeChange?.("larry")}
              className={cn(
                "flex min-h-12 items-center gap-1 rounded-full border-2 pl-1.5 pr-2.5 text-label font-bold transition-colors sm:gap-2 sm:pl-2.5 sm:pr-4",
                toLarry ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
              )}
            >
              <LarryAvatar size="xs" decorative className={cn("max-sm:size-5!", toLarry ? "ring-paper" : "ring-ink")} />
              Ask {APP_NAME}
            </button>
            <button
              type="button"
              aria-pressed={!toLarry}
              onClick={chooseJustUs}
              className={cn(
                "flex min-h-12 items-center gap-1 rounded-full border-2 pl-2.5 pr-2.5 text-label font-bold transition-colors sm:gap-2 sm:pl-3 sm:pr-4",
                !toLarry ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
              )}
            >
              <Users className="size-4 sm:size-5" aria-hidden />
              Just us
            </button>
          </div>
          {onAwayChange && (
            <button
              ref={excuseRef}
              type="button"
              onClick={() => changeAway(true)}
              className="flex min-h-12 items-center gap-1 rounded-full border-2 border-border-subtle bg-paper px-2.5 text-label font-bold text-ink transition-colors hover:border-border-control sm:gap-2 sm:px-4"
            >
              <LogOut className="size-4 sm:size-5" aria-hidden />
              Excuse {APP_NAME}
            </button>
          )}
          {showQuestions && (
            <button
              type="button"
              aria-expanded={questionsOpen}
              aria-controls={questionsId}
              onClick={() => setQuestionsOpen((v) => !v)}
              className="ml-auto flex min-h-12 items-center gap-0.5 rounded-full px-1 text-label font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-paper lg:hidden"
            >
              Questions
              <ChevronDown className={cn("size-4 transition-transform", questionsOpen && "rotate-180")} aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* Questions for Larry: their own group, apart from the replies between the two people.
          Always open on wide screens; behind "Questions" on phones. */}
      {showQuestions && (
        <fieldset
          id={questionsId}
          className={cn(
            "grid-cols-2 gap-2 rounded-mini border-2 border-border-subtle bg-paper px-2 pb-2",
            questionsOpen ? "grid" : "hidden lg:grid",
          )}
        >
          <legend className="px-1.5 text-label font-bold text-ink">Questions for {APP_NAME}</legend>
          {larryQuestions.map((q) => (
            <button
              key={q}
              type="button"
              aria-disabled={blocked(true)}
              onClick={() => {
                if (blocked(true)) return;
                setQuestionsOpen(false);
                onModeChange?.("larry");
                submit(q, true);
              }}
              className={chipStyles({ variant: "table", className: "px-3" })}
            >
              {q}
            </button>
          ))}
        </fieldset>
      )}

      {/* The one-tap replies, labelled with whose they are. When Larry asks someone by name, the
          session selects that person, so a single tap answers as the person asked. */}
      {replies.length > 0 && (
        <fieldset
          className={cn(
            "rounded-mini border-2 bg-paper px-2 pb-2",
            repliesHighlight ? "border-ink" : "border-border-subtle",
          )}
        >
          <legend className="flex items-center gap-1.5 px-1.5 text-label font-bold text-ink">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: speaker?.color }} />
            {repliesLabel ?? (speaker ? `${speaker.name}'s replies` : "Replies")}
            {replyTo && <span className="sr-only"> to {replyTo}</span>}
          </legend>
          <div
            className={cn(
              tinyReplies ? "grid grid-cols-4 gap-2" : shortReplies ? "grid grid-cols-2 gap-2 min-[480px]:grid-cols-4" : "flex flex-wrap gap-2",
            )}
          >
            {replies.map((q) => (
              <button
                key={q}
                type="button"
                aria-disabled={sendBusy}
                onClick={() => submit(q)}
                className={chipStyles({ className: cn("hover:bg-table", shortReplies && "px-2") })}
                // The speaker's seat colour frames their replies (a marker, never text colour).
                style={sendBusy ? undefined : { borderColor: speaker?.color }}
              >
                {q}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {menuOpen && (
        <LarryCommandMenu
          id={menuId}
          commands={commands}
          active={active}
          onActive={setActiveCmd}
          onPick={pick}
          listRef={listRef}
          focusable={menuFrom === "button"}
          onListKey={(e) => void menuKey(e)}
          onLeave={(to) => {
            if (menuFrom === "button" && to !== atButtonRef.current) setMenuFrom(null);
          }}
        />
      )}

      <PromptInput
        value={input}
        onValueChange={(text) => {
          setInput(text);
          setActiveCmd(0);
        }}
        isLoading={isLoading}
        onSubmit={() => submit()}
        disabled={disabled}
        onKey={larryMenu ? composerKey : undefined}
        textareaRef={textRef}
        comboProps={
          larryMenu
            ? {
                role: "combobox",
                "aria-expanded": typedMenu,
                "aria-controls": menuId,
                "aria-autocomplete": "list",
                "aria-activedescendant": typedMenu && commands.length ? `${menuId}-opt-${active}` : undefined,
              }
            : undefined
        }
        className={cn(speech.listening && "border-cat-film")}
      >
        {/* Only a shared phone needs "who is talking"; practice has one person. */}
        <div className={cn("flex flex-wrap items-center gap-1.5 px-1 pb-1 sm:gap-2", speakers.length < 2 && "hidden")}>
          <span id={labelId} className="px-0.5 text-label font-bold text-ink-soft sm:px-1">
            Who is talking?
          </span>
          <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5 sm:gap-2">
            {speakers.map((s, i) => (
              <button
                key={s.name + i}
                type="button"
                aria-pressed={i === activeSpeaker}
                onClick={() => onSpeakerChange(i)}
                className={cn(
                  "flex min-h-12 items-center gap-1.5 rounded-full border-2 px-3 text-body font-bold transition-colors sm:gap-2 sm:px-4",
                  i === activeSpeaker ? "border-ink bg-ink text-paper" : "border-border-subtle bg-table text-ink hover:border-border-control",
                )}
              >
                <span aria-hidden className="size-3 rounded-full ring-2 ring-paper" style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {speech.listening && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_DEAL }}
              className="overflow-hidden"
            >
              <p className="flex items-center gap-2.5 px-3 pt-1 text-label font-bold text-ink" role="status">
                <span className="relative flex size-2.5 shrink-0" aria-hidden>
                  {/* A live "recording" light while the mic is on: real state, not decoration. */}
                  <span className="absolute inline-flex size-full rounded-full bg-cat-film opacity-60 motion-safe:animate-ping" /> {/* taste-skill-ignore */}
                  <span className="relative inline-flex size-2.5 rounded-full bg-cat-film" />
                </span>
                Listening to {speaker?.name}. Tap stop when you are done.
              </p>
              {/* The words appear in the box as they are heard; nothing is sent until the person taps send. */}
              <div role="group" aria-label="Mic language" className="flex flex-wrap items-center gap-2 px-2 pt-1.5">
                {SPEECH_LANGS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    aria-pressed={speech.lang === l.value}
                    onClick={() => speech.setLang(l.value)}
                    className={chipStyles({ pressed: speech.lang === l.value, variant: "table", className: "px-3" })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="px-3 pt-1 text-caption text-ink-soft">{SPEECH_HONESTY}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-2">
          {larryMenu && (
            // Once tapped, the button becomes the @Larry chip at the start of the message, with a
            // small x to take the tag off. Tapping the chip itself opens the menu again.
            <div
              className={cn(
                "flex h-12 shrink-0 items-center rounded-full border-2 border-ink transition-colors",
                isTagged ? "bg-ink text-paper" : "bg-paper text-ink",
              )}
            >
              <button
                ref={atButtonRef}
                type="button"
                // The name matches what it shows ("@Larry"); the @ is drawn as an icon.
                aria-label={`@${APP_NAME}`}
                aria-haspopup="listbox"
                aria-expanded={menuFrom === "button"}
                aria-controls={menuId}
                onClick={tapAtLarry}
                className={cn(
                  "flex h-full items-center gap-1 rounded-full pl-1.5 text-label font-bold transition-colors",
                  isTagged ? "pr-1" : "pr-3 hover:bg-table",
                )}
              >
                <LarryAvatar size="xs" decorative className={isTagged ? "ring-paper" : "ring-ink"} />
                <AtSign className="-mr-1 size-4" aria-hidden />
                {APP_NAME}
              </button>
              {isTagged && (
                <button
                  type="button"
                  aria-label={`Remove the @${APP_NAME} tag`}
                  onClick={removeTag}
                  className="grid h-full w-8 place-items-center rounded-full hover:bg-ink-soft"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          )}
          <PromptInputTextarea
            label={`Message from ${speaker?.name ?? "you"}${isTagged ? ` to ${APP_NAME}` : ""}`}
            placeholder={placeholder}
          />

          <PromptInputAction tooltip={action.label}>
            <button
              type="button"
              onClick={() => !actionBlocked && action.run()}
              aria-disabled={actionBlocked}
              aria-label={action.label}
              className={cn(
                "relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border-2 transition-colors active:scale-95",
                actionMode === "send" && "border-ink bg-ink text-paper",
                actionMode === "stop" && "border-cat-film bg-cat-film text-ink",
                actionMode === "mic" && "border-border-subtle bg-table text-ink hover:border-border-control",
                // Blocked: a tone change, not a fade.
                "aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:bg-table aria-disabled:text-ink-soft",
              )}
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={actionMode}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: DURATION.quick, ease: EASE_DEAL }}
                  className="grid place-items-center"
                  aria-hidden
                >
                  {actionMode === "send" ? (
                    <ArrowUp className="size-5" />
                  ) : actionMode === "stop" ? (
                    <Square className="size-4 fill-ink" />
                  ) : (
                    <Mic className="size-5" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </PromptInputAction>
        </div>
        {input.length > MESSAGE_MAX - 80 && (
          <p className="px-3 pb-1 text-label text-ink-soft" aria-live="polite">
            {MESSAGE_MAX - input.length} letters left
          </p>
        )}
        {!speech.supported && (
          <p className="px-3 pb-1 text-caption text-ink-soft">{SPEECH_UNSUPPORTED}</p>
        )}
        {speech.error && (
          <p role="alert" className="px-3 pb-1 text-label font-bold text-danger">
            {speech.error}
          </p>
        )}
      </PromptInput>
    </div>
  );
}
