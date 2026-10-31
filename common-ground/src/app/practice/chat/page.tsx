"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, Flag, Heart, LifeBuoy, Loader2, MapPinOff, Moon, Plus } from "lucide-react";
import { BridgeCard, BridgeCardSkeleton } from "@/components/bridge-card";
import { HiddenGemsMoreOptions } from "@/components/hidden-gems-switch";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { MoodPicker } from "@/components/mood-picker";
import { EndPanel, type DraftStep } from "@/components/chat/end-panel";
import { HelpDialog, type HelpHandle } from "@/components/chat/help-dialog";
import { PlaceCard, type FitPeople } from "@/components/place-card";
import { PlanTicketView } from "@/components/plan-ticket";
import { LearnedNote, usePersonaLearning } from "@/components/meet-chat/larry-learned";
import { Poster, TasteCard } from "@/components/taste-card";
import { Button, ChatBubble, Dialog } from "@/components/ui";
import { type ComposerMode, PromptInputBox } from "@/components/ui/ai-prompt-box";
import { addressedSeat } from "@/lib/addressed";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { CRISIS_TEXT, looksLikeCrisis } from "@/lib/crisis";
import { type ChatEvent, type PairChatResult, HISTORY_TURNS, practiceTurnsFor } from "@/lib/chat-protocol";
import type { PersonaUpdate, PlaceCard as PlaceCardData, PlanTicket, SuggestInput } from "@/lib/contracts";
import { findPersona, seatColors, type Persona } from "@/lib/demo";
import { LOCATION_OFF_LINE, LOCATION_SETTINGS_HREF, useApproxLocation } from "@/lib/location";
import { recentPlacesField, signalsField } from "@/lib/mood";
import { personaForRequest } from "@/lib/persona";
import { addSteps, useProfile, useSteps } from "@/lib/storage";
import { buildTicket, FALLBACK_NUDGES, fetchSuggest, suggestSteps } from "@/lib/suggest-steps";
import type { CommonGround, Place, Profile } from "@/lib/types";
import { useHeightVar } from "@/lib/use-height-var";
import { cn } from "@/lib/utils";
import { DURATION, EASE_DEAL } from "@/lib/tokens";

type Seat = "a" | "b";
type Message =
  | { id: string; kind: "text"; from: "larry" | Seat; text: string; quietMode?: boolean; excused?: boolean }
  | { id: string; kind: "step"; text: string }
  | { id: string; kind: "places"; places: Place[] }
  | { id: string; kind: "ticket"; ticket: PlanTicket }
  | { id: string; kind: "help" };
interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
/** What /api/chat may add for the Plan Ticket and Larry's picture of this phone's person. */
type ChatResult = PairChatResult & { planTicket?: PlanTicket; personaUpdate?: PersonaUpdate; places?: (Place | PlaceCardData)[] };

/** One-tap replies between the two people (spec section 7), said by whoever is selected. */
const REPLIES = ["Yes", "Tell me more", "Your turn", "Not for me"];
/** Questions for Larry, kept in their own group. Each one is a live Qloo lookup. */
const LARRY_QUESTIONS = ["What do we both like?", "What should we watch together?", "Where could we hang out?", "Give us a game to play now"];
const QUICK_PRACTICE = ["Hi!", "What do you like about it?", "Have you seen it?", "Your turn"];
/** Larry steps back after this many "Just us" messages in a row... */
const JUST_US_LIMIT = 3;
/** ...or after replying [quiet] (nothing to add) this many times in a row. */
const QUIET_LIMIT = 2;
/** ...or when nobody has sent anything for this long after Larry's last reply (they're talking out loud). */
const IDLE_FADE_MS = 50_000;
const FADE_TEXT = "You two seem fine without me. I'll be here if you need me.";
/** Shown once per device, the first time someone taps "Just us". */
const JUST_US_NOTE = `Just you two now. ${APP_NAME} is listening, not replying.`;
const BRIDGES_SHOWN = 4;
/** A practice nudge changes after this many messages from the person. */
const NUDGE_EVERY = 2;

/** Whether a media query matches; false on the server. */
function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Pick a pal (D25/D26): the only one-phone chat left. You and a made-up practice pal, never a real
// second person (real people meet in a Group, by QR). Your card comes from this phone, the pal from
// the server's list, so the link carries nothing about anyone else.
function usePractice() {
  const params = useSearchParams();
  const mine = useProfile();
  return React.useMemo(() => {
    const persona = findPersona(params.get("persona"));
    return { a: mine ?? null, b: persona?.profile ?? null, persona, demo: false, owner: persona ? ("a" as Seat) : undefined, loading: mine === undefined };
  }, [params, mine]);
}

function Pair() {
  const { a, b, persona, demo, owner, loading } = usePractice();
  if (loading) return <div className="flex-1" />;
  if (!a || !b) {
    return (
      <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-5 px-5">
        <h1 className="font-display text-title-lg font-black leading-none">{a ? "Pick a pal first" : "Make your card first"}</h1>
        <p className="text-lead text-ink-soft">{a ? "Choose who you'd like to practise with." : "Your pal needs your picks to find your common ground."}</p>
        <LinkButton href={a ? "/practice" : "/create"}>{a ? "Pick a pal" : "Make my taste card"}</LinkButton>
      </main>
    );
  }
  return <Session initialA={a} initialB={b} persona={persona} demo={demo} owner={owner} />;
}

/** Reads the /api/chat NDJSON stream, reporting progress, and returns the final result. */
async function readChat(res: Response, onProgress: (text: string) => void): Promise<PairChatResult> {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${APP_NAME} couldn't answer. Try again.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type === "progress") onProgress(event.text);
      else if (event.type === "done") return event.result;
      else throw new Error(event.error);
    }
    if (done) break;
  }
  throw new Error(`${APP_NAME} stopped before answering. Try again.`);
}

function Session({
  initialA,
  initialB,
  persona,
  demo,
  owner,
}: {
  initialA: Profile;
  initialB: Profile;
  persona?: Persona;
  demo: boolean;
  owner?: Seat;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [a, setA] = React.useState(initialA);
  const [b, setB] = React.useState(initialB);
  const seatColor = seatColors(persona);

  const [ground, setGround] = React.useState<CommonGround | null>(null);
  const [groundError, setGroundError] = React.useState<string | null>(null);
  const [showAllBridges, setShowAllBridges] = React.useState(false);

  const [messages, setMessages] = React.useState<Message[]>([]);
  const historyRef = React.useRef<ChatTurn[]>([]);
  // One request at a time: a second send while Larry replies would race the history.
  const inFlight = React.useRef(false);
  const [sending, setSending] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [announce, setAnnounce] = React.useState("");
  const [speaker, setSpeaker] = React.useState(0);
  // The fade. "Just us" messages never call Larry; a run of them, Larry choosing [quiet] twice, or
  // a quiet minute while the two talk out loud steps Larry back until it is asked again.
  const [mode, setMode] = React.useState<ComposerMode>("larry");
  const [faded, setFaded] = React.useState(false);
  const justUsRun = React.useRef(0);
  const quietRun = React.useRef(0);
  // "Excuse Larry": Larry sees nothing until "Hello Larry". Lines typed meanwhile stay on this
  // screen only: never sent, never in Larry's history, never checked by a model. The ref is read
  // by callbacks that outlive a render (a reply arriving after Larry was excused).
  const [away, setAway] = React.useState(false);
  const awayRef = React.useRef(false);
  const callCtrl = React.useRef<AbortController | null>(null);
  // D24: the coarse point stored at onboarding. Never a "share location" button here.
  const approx = useApproxLocation();
  const location = React.useMemo(
    () => (approx.location ? { lat: approx.location.lat, lon: approx.location.lon } : null),
    [approx.location],
  );
  // Bumped by the Hidden Gems switch, so the bridges are asked for again with the new signal.
  const [groundAsk, setGroundAsk] = React.useState(0);
  const [groundGems, setGroundGems] = React.useState(false);
  const [places, setPlaces] = React.useState<(Place | PlaceCardData)[]>([]);
  // The Plan Ticket: Larry's own, or one built here from the place someone chose and the best bridge.
  const [agentTicket, setAgentTicket] = React.useState<PlanTicket | null>(null);
  const [chosenPlace, setChosenPlace] = React.useState<Place | PlaceCardData | null>(null);
  const [endView, setEndView] = React.useState<"ticket" | "steps">("ticket");
  // This phone's person: Larry uses their saved persona, and what it learns is merged back (with Undo).
  const { persona: savedPersona, note: learnedNote, learn, undo: undoLearned, dismiss: dismissLearned } = usePersonaLearning();
  const tastePersona = owner && !persona ? savedPersona : null;
  const [steps, setSteps] = React.useState<DraftStep[]>([]);
  const [ending, setEnding] = React.useState(false);
  const [practiceDone, setPracticeDone] = React.useState(false);
  const [userTurns, setUserTurns] = React.useState(0);

  const headerRef = React.useRef<HTMLElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const finishRef = React.useRef<HTMLButtonElement>(null);
  const helpRef = React.useRef<HelpHandle>(null);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const isSm = useMediaQuery("(min-width: 640px)");
  const isLg = useMediaQuery("(min-width: 1024px)");

  // The other fade: each real-world First Step marked done shortens practice (8, then 6, then 4).
  const storedSteps = useSteps();
  const stepsDone = storedSteps?.filter((s) => s.done).length ?? 0;
  const practiceCap = practiceTurnsFor(stepsDone);
  useHeightVar(headerRef, "--header-h");
  useHeightVar(composerRef, "--composer-h");

  // Whose phone this is decides who the First Step is "with".
  // A practice pal is never a real person to plan with.
  const other = persona ? undefined : owner === "a" ? b : owner === "b" ? a : undefined;
  const me = owner === "b" ? b : a;

  // Common ground, straight from Qloo.
  React.useEffect(() => {
    const ctrl = new AbortController();
    const sent = signalsField();
    const sentGems = sent.signals?.hiddenGems === true;
    apiFetch("/api/common-ground", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // This phone's mood, age range and Hidden Gems: the person's own request only.
      body: JSON.stringify({ a: initialA, b: initialB, ...sent }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Hmm, your common ground didn't load. Try again in a moment?");
        setGroundError(null);
        setGround(body);
        // The bridges were found with Hidden Gems on only if this request carried it.
        setGroundGems(sentGems);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setGroundError(err.message);
      });
    return () => ctrl.abort();
  }, [initialA, initialB, groundAsk]);

  // Practice: a few very short warm lines, written by the AI once per session from the real picks,
  // shown one at a time instead of a message countdown. Fixed lines until (or unless) they arrive.
  const [nudges, setNudges] = React.useState<string[]>(FALLBACK_NUDGES);
  const nudgesAsked = React.useRef(false);
  React.useEffect(() => {
    if (!persona || nudgesAsked.current || (!ground && !groundError)) return;
    // Asked once and never aborted: a re-run of this effect must not cancel the only request.
    nudgesAsked.current = true;
    fetchSuggest({
      kind: "nudges",
      names: [a.name, b.name],
      picks: [...a.items, ...b.items].map((i) => i.name).slice(0, 12),
      bridges: (ground?.bridges ?? []).map((x) => x.name).slice(0, 6),
      places: [],
      ...signalsField(),
    }, undefined, undefined, apiFetch).then((r) => {
      if (r?.nudges.length) setNudges(r.nudges);
    });
  }, [persona, ground, groundError, a, b]);

  const callLarry = React.useCallback(
    async (history: ChatTurn[], previous: ChatTurn[]) => {
      if (awayRef.current) return;
      inFlight.current = true;
      setSending(true);
      setProgress(null);
      setChatError(null);
      const ctrl = new AbortController();
      callCtrl.current = ctrl;
      try {
        const res = await apiFetch("/api/chat", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            a,
            b,
            history,
            ground: ground ?? undefined,
            location: location ?? undefined,
            persona: persona?.id,
            stepsDone,
            ...signalsField(),
            ...recentPlacesField(),
            // The device owner's saved persona (likes, dislikes, notes), so Larry can use and grow it.
            ...(tastePersona ? { myPersona: personaForRequest(tastePersona), mySeat: owner } : {}),
          }),
        });
        const body: ChatResult = await readChat(res, setProgress);
        // Excused while Larry was thinking: its reply is dropped, and Larry starts fresh later.
        if (ctrl.signal.aborted || awayRef.current) return;

        const out = body.messages;
        const assistantText = body.quiet
          ? "[quiet]"
          : persona
            ? out.map((m) => `[${m.from === "b" ? b.name : APP_NAME}] ${m.text}`).join("\n")
            : out.map((m) => m.text).join("\n");
        historyRef.current = [...history, { role: "assistant" as const, content: assistantText }].slice(-HISTORY_TURNS);
        if (!persona) {
          if (body.quiet) {
            quietRun.current += 1;
            if (quietRun.current >= QUIET_LIMIT) {
              // Larry had nothing to add twice: step back, and stop calling it until asked.
              setFaded(true);
              setMode("us");
              setAnnounce(FADE_TEXT);
            }
          } else if (out.length) {
            quietRun.current = 0;
            setFaded(false);
          }
          // Larry ends by asking one person by name: the one-tap replies now answer as them.
          // Tapping the other name in "Who is talking?" still overrides this.
          const asked = body.crisis ? undefined : [...out].reverse().find((m) => m.from === "larry");
          const seat = asked && addressedSeat(asked.text, a.name, b.name);
          if (seat) setSpeaker(seat === "a" ? 0 : 1);
        }

        const added: Message[] = out.map((x) => ({
          id: crypto.randomUUID(),
          kind: "text" as const,
          from: x.from,
          text: x.text,
        }));
        if (body.crisis) added.push({ id: crypto.randomUUID(), kind: "help" });
        if (body.places?.length) {
          setPlaces(body.places);
          added.push({ id: crypto.randomUUID(), kind: "places", places: body.places.slice(0, 3) });
        }
        if (body.planTicket && !persona) {
          setAgentTicket(body.planTicket);
          setChosenPlace(null);
          added.push({ id: crypto.randomUUID(), kind: "ticket", ticket: body.planTicket });
        }
        if (body.personaUpdate && tastePersona) learn(body.personaUpdate);
        for (const s of body.steps ?? []) added.push({ id: crypto.randomUUID(), kind: "step", text: s.text });
        if (added.length) setMessages((m) => [...m, ...added]);
        if (out.length) setAnnounce(out.map((m) => `${m.from === "b" ? b.name : APP_NAME} says: ${m.text}`).join(" "));

        if (body.steps?.length) setSteps((s) => [...s, ...body.steps]);
        if (body.bridges?.length) setGround((g) => (g ? { ...g, bridges: body.bridges! } : g));
        // Picks as they stand after this reply's updates (state setters below are queued).
        const now = { a: new Set(a.items.map((i) => i.id)), b: new Set(b.items.map((i) => i.id)) };
        for (const u of body.profileUpdates ?? []) {
          const set = u.person === "a" ? setA : setB;
          set((p) => (p.items.some((i) => i.id === u.item.id) ? p : { ...p, items: [...p.items, u.item] }));
          now[u.person].add(u.item.id);
          // A new pick the other person already has is now something you both picked.
          if (now[u.person === "a" ? "b" : "a"].has(u.item.id)) {
            setGround((g) => (g && !g.shared.some((i) => i.id === u.item.id) ? { ...g, shared: [...g.shared, u.item] } : g));
          }
        }
        if (body.wrapUp) {
          setPracticeDone(true);
          setEnding(true);
        }
      } catch (err) {
        // Stopped by "Excuse Larry": nothing failed, and the history is already cleared.
        if (ctrl.signal.aborted || awayRef.current) return;
        // Forget the turn that failed, so the next message isn't stuck behind it.
        historyRef.current = previous;
        if (previous.length < history.length && history.at(-1)?.role === "user") setUserTurns((n) => Math.max(0, n - 1));
        setChatError((err as Error).message);
      } finally {
        if (callCtrl.current === ctrl) {
          callCtrl.current = null;
          inFlight.current = false;
          setSending(false);
          setProgress(null);
        }
      }
    },
    [a, b, ground, location, persona, stepsDone, tastePersona, owner, learn],
  );

  // Larry opens once the common ground is in, so the opening needs no extra Qloo round trip.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || (!ground && !groundError)) return;
    opened.current = true;
    callLarry([], []);
  }, [callLarry, ground, groundError]);

  // Follow new messages. Larry's opening only scrolls as far as it must: on phones the fixed
  // composer can cover it, so it is brought up to end just above the composer (scroll-padding
  // holds --composer-h), keeping as much of the bridge strip in view as possible.
  const chatRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (messages.length === 0) return;
    if (messages.length === 1) {
      if (isLg) return;
      const id = requestAnimationFrame(() => {
        const bubbles = chatRef.current?.querySelectorAll("[data-bubble]");
        bubbles?.[bubbles.length - 1]?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      });
      return () => cancelAnimationFrame(id);
    }
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages, sending, reduce, isLg]);

  const speakers = persona
    ? [{ name: a.name, color: seatColor.a }]
    : [
        { name: a.name, color: seatColor.a },
        { name: b.name, color: seatColor.b },
      ];

  const send = (text: string, toLarry: boolean) => {
    if (inFlight.current) return;
    // Someone spoke first: Larry answers that instead of opening on top of it.
    opened.current = true;
    const seat: Seat = speaker === 0 || persona ? "a" : "b";
    const who = seat === "a" ? a.name : b.name;

    // Larry is excused: the line stays on this screen only. It is never sent anywhere and never
    // goes into Larry's history. Crisis words still get the helplines card, checked on the device
    // with no model call and no Larry reply.
    if (awayRef.current) {
      const excusedLine: Message = { id: crypto.randomUUID(), kind: "text", from: seat, text, excused: true };
      const crisis = looksLikeCrisis(text);
      setMessages((m) => [...m, excusedLine, ...(crisis ? [{ id: crypto.randomUUID(), kind: "help" as const }] : [])]);
      if (crisis) setAnnounce("Help is one tap away. See helplines.");
      return;
    }

    const line: Message = { id: crypto.randomUUID(), kind: "text", from: seat, text };
    const previous = historyRef.current;
    // "Just us" lines stay in the history, so Larry has the context when asked again.
    const history = [...previous, { role: "user" as const, content: `[${who}] ${text}` }].slice(-HISTORY_TURNS);

    // Crisis first, whatever the mode: a "Just us" line never reaches the server, so the check runs
    // here too. Larry answers with the fixed help reply and the helplines card. No model call.
    if (looksLikeCrisis(text)) {
      const reply = persona ? `[${APP_NAME}] ${CRISIS_TEXT}` : CRISIS_TEXT;
      historyRef.current = [...history, { role: "assistant" as const, content: reply }].slice(-HISTORY_TURNS);
      setMessages((m) => [
        ...m,
        line,
        { id: crypto.randomUUID(), kind: "text", from: "larry", text: CRISIS_TEXT },
        { id: crypto.randomUUID(), kind: "help" },
      ]);
      setAnnounce(`${APP_NAME} says: ${CRISIS_TEXT}`);
      justUsRun.current = 0;
      quietRun.current = 0;
      setFaded(false);
      setMode("larry");
      return;
    }

    setMessages((m) => [...m, line]);
    historyRef.current = history;
    if (!persona && !toLarry) {
      // Between the two of them: no AI call, no cost.
      justUsRun.current += 1;
      if (justUsRun.current >= JUST_US_LIMIT && !faded) {
        setFaded(true);
        setAnnounce(FADE_TEXT);
      }
      return;
    }
    justUsRun.current = 0;
    setUserTurns((n) => n + 1);
    callLarry(history, previous);
  };

  /** "Excuse Larry": Larry leaves and sees nothing. A reply on its way is stopped and dropped. */
  const excuseLarry = () => {
    awayRef.current = true;
    setAway(true);
    // Larry must not open the chat later, while it is out.
    opened.current = true;
    callCtrl.current?.abort();
    callCtrl.current = null;
    inFlight.current = false;
    setSending(false);
    setProgress(null);
    setChatError(null);
    historyRef.current = [];
    justUsRun.current = 0;
    quietRun.current = 0;
    setFaded(false);
  };

  /** "Hello Larry": Larry comes back and starts fresh. It never sees what was said while it was out. */
  const helloLarry = () => {
    awayRef.current = false;
    setAway(false);
    historyRef.current = [];
    justUsRun.current = 0;
    quietRun.current = 0;
    setFaded(false);
    setMode("larry");
  };

  /** "Need Larry?": undo the fade and ask Larry again. */
  const wakeLarry = () => {
    justUsRun.current = 0;
    quietRun.current = 0;
    setFaded(false);
    setMode("larry");
    setAnnounce(`${APP_NAME} is listening again.`);
  };

  // With a stored point, look up a nearby place for the tap-only First Step suggestions.
  React.useEffect(() => {
    if (!ending || !location || places.length || persona) return;
    const ctrl = new AbortController();
    const items = [...a.items, ...b.items].map((i) => ({ id: i.id, name: i.name }));
    apiFetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.slice(0, 30), lat: location.lat, lon: location.lon, ...signalsField(), ...recentPlacesField() }),
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : { places: [] }))
      .then((body) => setPlaces(body.places ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [ending, location, places.length, persona, a.items, b.items]);

  // A practice round is capped at practiceCap messages. The server wraps up on the last one; if it
  // doesn't (an older server, a different cap), the round still closes here once that reply is in.
  const practiceOver = !!persona && (practiceDone || (userTurns >= practiceCap && !sending));
  const practiceLocked = !!persona && userTurns >= practiceCap;
  const showEnd = ending || practiceOver;

  // The idle fade (spec section 7, rule 5): two people talking out loud send nothing, so a quiet
  // stretch after Larry's last reply is the sign they're fine. Any new message restarts the wait.
  // Typing counts as talking (persona walkthrough, Meera; user-research R4): a key, a tap in the
  // composer, or an unsent draft (typed or from the mic) holds the fade off, so Larry never steps
  // back while someone is still writing or getting a word out.
  const larryHasSpoken = messages.some((m) => m.kind === "text" && m.from === "larry");
  const lastActivity = React.useRef(0);
  React.useEffect(() => {
    if (persona || away || faded || sending || showEnd || !larryHasSpoken) return;
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      const draft = composerRef.current?.querySelector("textarea")?.value.trim();
      const sinceActivity = Date.now() - lastActivity.current;
      if (draft || sinceActivity < IDLE_FADE_MS) {
        t = setTimeout(check, draft ? IDLE_FADE_MS : IDLE_FADE_MS - sinceActivity);
        return;
      }
      setFaded(true);
      setAnnounce(FADE_TEXT);
    };
    t = setTimeout(check, IDLE_FADE_MS);
    return () => clearTimeout(t);
  }, [persona, away, faded, sending, showEnd, larryHasSpoken, messages.length]);

  // The end panel is taller than the composer, and changes height (choices → share QR): each time
  // it settles, bring the last lines back just above it.
  React.useEffect(() => {
    const panel = composerRef.current;
    if (!showEnd || !panel) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const follow = () => {
      clearTimeout(t);
      t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" }), 150);
    };
    const ro = new ResizeObserver(follow);
    ro.observe(panel);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [showEnd, reduce]);

  const closeEnd = () => {
    setEnding(false);
    requestAnimationFrame(() => finishRef.current?.focus());
  };

  /** "Plan this" on a place: the session ends on a Plan Ticket for it. */
  const planPlace = (place: Place | PlaceCardData) => {
    setChosenPlace(place);
    setEndView("ticket");
    setEnding(true);
  };
  /** "See the plan" on Larry's ticket in the chat. */
  const openTicket = (t: PlanTicket) => {
    setAgentTicket(t);
    setChosenPlace(null);
    setEndView("ticket");
    setEnding(true);
  };

  const suggestions = suggestSteps({ ground, places, me, other, practice: !!persona }).filter(
    (s) => !steps.some((x) => x.text === s.text),
  );
  // Fit order: the strongest Qloo match first, and only that one is marked "Best fit".
  // Larry's curated order (best first) is kept; only Qloo's own fallback list is sorted by affinity.
  const bridges = React.useMemo(() => (ground?.curated ? [...(ground.bridges ?? [])] : [...(ground?.bridges ?? [])].sort((x, y) => y.affinity - x.affinity)), [ground]);
  const people: FitPeople = { a: { name: a.name, color: seatColor.a }, b: { name: b.name, color: seatColor.b } };
  // The same two seats for the bridge cards: seat a, then seat b.
  const seats = [
    { id: "a", name: a.name, color: seatColor.a },
    { id: "b", name: b.name, color: seatColor.b },
  ];
  // Never with a practice pal: a Plan Ticket is for real people. Larry's ticket wins unless
  // someone chose a different place; otherwise the chosen (or first) place with the best bridge.
  const ticket = React.useMemo<PlanTicket | null>(() => {
    if (persona) return null;
    if (agentTicket && (!chosenPlace || chosenPlace.id === agentTicket.place.id)) return agentTicket;
    const place = chosenPlace ?? places[0];
    return place ? buildTicket({ place, bridge: bridges[0], shared: ground?.shared[0] }) : null;
  }, [persona, agentTicket, chosenPlace, places, bridges, ground]);
  const sharedCount = ground?.shared.length ?? 0;
  // True counts only: what they both picked, and what Qloo thinks they might both like.
  const counts = [
    sharedCount ? `${sharedCount} you both picked` : null,
    bridges.length ? `${bridges.length} you might both like` : null,
  ].filter((c): c is string => !!c);
  // Leaving loses the chat (it isn't stored) and any First Step not saved yet.
  const hasProgress = steps.length > 0 || messages.some((m) => m.kind === "text" && m.from !== "larry");
  const nudge = nudges[Math.floor(userTurns / NUDGE_EVERY) % nudges.length];
  // What the AI may write fresh First Steps from: real picks, bridges and places only.
  const suggestInput: SuggestInput | undefined = ground
    ? {
        kind: "steps",
        names: persona ? [a.name] : [a.name, b.name],
        picks: (persona ? a.items : [...a.items, ...b.items]).map((i) => i.name).slice(0, 12),
        bridges: persona ? [] : bridges.map((x) => x.name).slice(0, 6),
        places: persona ? [] : places.slice(0, 3).map((p) => ({ name: p.name, kind: p.tags[0] })),
      }
    : undefined;
  const larryStatus = groundError
    ? groundError
    : ground
      ? bridges.length
        ? `Found ${bridges.length} ${bridges.length === 1 ? "thing" : "things"} you'd both probably like.`
        : `${APP_NAME} didn't find a strong match this time.`
      : `${APP_NAME} is digging through your cards for what you share…`;

  // D24: no "share location" button. With no stored point, one plain line pointing to Settings.
  const locationBlock = !persona && !location && (
    <p className="mt-3 flex items-start gap-2 text-label text-ink">
      <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <Link href={LOCATION_SETTINGS_HREF} className="underline decoration-2 underline-offset-4 hover:bg-paper">
        {LOCATION_OFF_LINE}
      </Link>
    </p>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b-2 border-ink bg-table [@media(max-height:500px)]:static"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-1.5 py-2 sm:gap-2 sm:px-3 lg:max-w-6xl lg:px-5">
          <Link
            href="/"
            aria-label="Leave session"
            onNavigate={(e) => {
              // One stray tap on a shared phone shouldn't throw the chat away.
              if (hasProgress) {
                e.preventDefault();
                setLeaveOpen(true);
              }
            }}
            className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-paper"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <p className="flex min-w-0 flex-1 items-center gap-1.5 font-display text-label font-black sm:gap-2 sm:text-lead">
            <span className="size-3 shrink-0 rounded-full" style={{ background: seatColor.a }} aria-hidden />
            <span className="truncate">{a.name}</span>
            {/* On phones the seat dots already separate the names. */}
            <span className="text-ink-soft max-sm:hidden" aria-hidden>
              ×
            </span>
            <span className="sr-only">and</span>
            <span className="size-3 shrink-0 rounded-full" style={{ background: seatColor.b }} aria-hidden />
            <span className="truncate">{b.name}</span>
          </p>
          <button
            type="button"
            onClick={() => helpRef.current?.open()}
            aria-label="Need help now?"
            className="press press-flat flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1 rounded-full px-2 font-bold text-ink hover:bg-paper sm:gap-1.5 sm:px-3"
          >
            <LifeBuoy className="size-5" aria-hidden />
            <span className="sm:hidden">Help</span>
            <span className="max-sm:hidden">Need help now?</span>
          </button>
          <button
            ref={finishRef}
            type="button"
            onClick={() => setEnding(true)}
            disabled={showEnd}
            // Disabled is a tone change (paper, a line ring, ink-soft words), never faded text.
            className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-ink px-3.5 text-label sm:px-4 font-bold text-paper hover:bg-ink-hover disabled:bg-paper disabled:text-ink-soft disabled:shadow-none disabled:ring-2 disabled:ring-line disabled:hover:bg-paper disabled:active:scale-100"
          >
            <Flag className="size-4 max-sm:hidden" aria-hidden /> Finish
          </button>
        </div>
      </header>
      <HelpDialog ref={helpRef} />
      <LeaveDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        unsavedStep={steps.length > 0 && !showEnd}
        onSaveFirst={() => setEnding(true)}
        onLeave={() => router.push("/")}
      />

      <main id="main"
        className="mx-auto w-full max-w-3xl flex-1 px-4 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-10 lg:px-5"
        style={{ paddingBottom: "calc(var(--composer-h) + 1.5rem)" }}
      >
        {/* The table: both cards, and the common ground dealt between them. Shrinks once dealt;
            on phones it shrinks further, so Larry's opening fits in the first screen. */}
        <section
          aria-labelledby="ground-title"
          className="pt-3 lg:sticky lg:top-[var(--header-h)] lg:max-h-[calc(100dvh-var(--header-h))] lg:overflow-y-auto lg:pb-6 lg:pt-4"
        >
          <motion.div
            className="relative mx-auto flex max-w-md items-start justify-center overflow-visible"
            initial={false}
            animate={{ height: ground ? (isSm ? 128 : 86) : 232 }}
            transition={reduce ? { duration: 0 } : { duration: DURATION.deal, ease: EASE_DEAL }}
          >
            {(["a", "b"] as const).map((seat) => (
              <motion.div
                key={seat}
                className={cn("absolute top-1", seat === "a" ? "left-[3%] sm:left-[6%]" : "right-[3%] sm:right-[6%]")}
                style={{ transformOrigin: seat === "a" ? "top left" : "top right" }}
                initial={false}
                animate={{
                  rotate: seat === "a" ? -8 : 7,
                  scale: ground ? (isSm ? 0.48 : 0.36) : 1,
                  y: seat === "a" ? 0 : 8,
                }}
                transition={reduce ? { duration: 0 } : { duration: DURATION.deal, ease: EASE_DEAL }}
              >
                <TasteCard profile={seat === "a" ? a : b} accent={seatColor[seat]} size="sm" />
              </motion.div>
            ))}
            <AnimatePresence>
              {ground && counts.length > 0 && (
                <motion.p
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: DURATION.base }}
                  className="absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-tile bg-ink px-3 py-1.5 text-center text-label font-bold leading-snug text-paper sm:top-9"
                >
                  {counts.map((c) => (
                    <span key={c}>
                      {c}
                      <span className="sr-only">.</span>
                    </span>
                  ))}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          <h1 id="ground-title" className="font-display sm:mt-1 text-title-session font-black leading-tight">
            Your common ground
          </h1>
          <p className="mt-0.5 text-label text-ink-soft sm:mt-1 sm:text-body">
            {APP_NAME} is an AI.
            <span className="max-sm:hidden"> It helps you two talk, then steps back.</span>
            {persona && ` ${b.name} is a made-up practice pal played by AI.`}
            {demo && " Sam and Priya are made up. Their picks are real."}
          </p>

          {/* Hidden Gems on the bridges, and this phone's mood (sent with this phone's requests only). */}
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <HiddenGemsMoreOptions
              description="Less-known picks you'd both like."
              onChange={() => setGroundAsk((n) => n + 1)}
            />
            <MoodPicker compact />
          </div>

          <p role="status" className={cn("mt-3 flex items-center gap-2", groundError ? "font-bold text-danger" : "text-ink-soft", ground && "sr-only")}>
            {!ground && !groundError && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />}
            {larryStatus}
          </p>

          {!ground && !groundError && (
            <ul className="-mx-4 mt-3 flex gap-3 overflow-hidden px-4 pb-3" aria-hidden>
              {[0, 1, 2].map((i) => (
                <li key={i} className="w-[17.5rem] shrink-0">
                  <BridgeCardSkeleton />
                </li>
              ))}
            </ul>
          )}

          {ground && (
            <>
              {/* On wide screens shared picks get their own row; on phones they lead the strip. */}
              {sharedCount > 0 && (
                <div className="mt-3 hidden flex-wrap items-center gap-2 lg:flex">
                  <span className="font-bold">You both picked</span>
                  {ground.shared.map((s) => (
                    <span key={s.id} className="flex items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 font-bold ring-2 ring-ink">
                      <Poster item={s} className="size-8 rounded-full border-2" sizes="32px" />
                      {s.name}
                    </span>
                  ))}
                </div>
              )}

              {/* On phones the count above already says this, and the next card peeks in from the edge. */}
              <h2 className="mt-4 font-bold max-lg:sr-only">
                You might both like
                {bridges.length + sharedCount > 1 && <span className="lg:hidden">. Swipe for more.</span>}
              </h2>
              {bridges.length === 0 && (
                <p className="mt-1 text-ink-soft">{APP_NAME} didn&apos;t find a strong match this time. Ask each other about your cards!</p>
              )}
              {(bridges.length > 0 || sharedCount > 0) && (
                // Phones and tablets: one short strip that scrolls sideways. Wide screens: a grid.
                // items-start, so opening "Why this?" on one card doesn't stretch its neighbours.
                <ul className="-mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 lg:pb-3">
                  {ground.shared.map((s) => (
                    <li key={s.id} className="w-[84%] max-w-[19rem] shrink-0 snap-start lg:hidden">
                      <article className="flex gap-3 rounded-mini border-(length:--border-frame) border-ink bg-paper p-2.5 shadow-mini">
                        <Poster item={s} className="h-20 w-14 shrink-0" sizes="72px" />
                        <div className="min-w-0 flex-1 py-0.5">
                          <h3 className="font-display text-body font-black leading-tight">{s.name}</h3>
                          <p className="mt-1.5 text-label font-bold leading-snug">You both picked this.</p>
                        </div>
                      </article>
                    </li>
                  ))}
                  {bridges.map((br, i) => (
                    <motion.li
                      key={br.id}
                      className={cn(
                        "w-[84%] max-w-[19rem] shrink-0 snap-start lg:w-auto lg:max-w-none",
                        !showAllBridges && i >= BRIDGES_SHOWN && "lg:hidden",
                      )}
                      initial={reduce ? false : { opacity: 0, y: -60, rotate: i % 2 ? 8 : -8, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
                      transition={{ delay: 0.08 * Math.min(i, 5), duration: DURATION.deal, ease: EASE_DEAL }}
                    >
                      <BridgeCard
                        bridge={br}
                        people={seats}
                        best={i === 0 && br.affinity > 0}
                        hiddenGem={groundGems}
                      />
                    </motion.li>
                  ))}
                </ul>
              )}
              {bridges.length > 0 && (
                <div className="hidden flex-wrap items-center justify-between gap-2 lg:flex">
                  <p className="text-label text-ink-soft">{APP_NAME} found these from what fans of your picks also love.</p>
                  {bridges.length > BRIDGES_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllBridges((v) => !v)}
                      aria-expanded={showAllBridges}
                      className="press press-flat min-h-12 rounded-full px-4 font-bold underline decoration-2 underline-offset-4 hover:bg-paper"
                    >
                      {showAllBridges ? "Show fewer" : `Show ${bridges.length - BRIDGES_SHOWN} more`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {isLg && locationBlock}
        </section>

        {/* The conversation. Only Larry's and the character's lines are announced (below). */}
        <div className="lg:pt-6">
          {/* Faded, the whole chat column dims: a darker ground (a tone change, never faded text). */}
          <section
            ref={chatRef}
            aria-label="Chat"
            className={cn(
              "-mx-3 -mt-1 flex flex-col gap-3 rounded-panel px-3 py-3 transition-colors duration-(--dur-deal) sm:mt-1 lg:-mt-3",
              faded && !persona ? "bg-line" : "bg-transparent",
            )}
          >
            {messages.map((m, i) => {
              if (m.kind === "step")
                return (
                  <p key={m.id} className="mx-auto flex max-w-full items-center gap-2 rounded-full bg-paper px-4 py-2 text-label font-bold ring-2 ring-cat-film">
                    <Flag className="size-4 shrink-0" aria-hidden /> First Step ready to save: {m.text}
                  </p>
                );
              if (m.kind === "places")
                return <PlacesMessage key={m.id} places={m.places} people={people} onPlan={planPlace} chosenId={showEnd ? ticket?.place.id : undefined} />;
              if (m.kind === "ticket")
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-mini border-(length:--border-frame) border-cat-film bg-paper p-3 sm:ml-11">
                    <Flag className="size-5 shrink-0" aria-hidden />
                    <p className="min-w-0 flex-1 font-bold leading-snug">
                      {APP_NAME} made a plan: {m.ticket.place.name}, {m.ticket.when}.
                    </p>
                    <button type="button" onClick={() => openTicket(m.ticket)} className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}>
                      See the plan
                    </button>
                  </div>
                );
              if (m.kind === "help")
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-ink bg-paper p-3">
                    <LifeBuoy className="size-5" aria-hidden />
                    <p className="flex-1 font-bold">Help is one tap away.</p>
                    <button type="button" onClick={() => helpRef.current?.open()} className={cn(buttonStyles.primary, "min-h-12")}>
                      See helplines
                    </button>
                  </div>
                );
              const prev = messages[i - 1];
              // Larry's name and "(AI pal)" show once per run of Larry messages.
              const continued = m.from === "larry" && prev?.kind === "text" && prev.from === "larry";
              return (
                <ChatBubble
                  key={m.id}
                  sender={m.from === "larry" ? "larry" : "person"}
                  name={m.from === "a" ? a.name : b.name}
                  seatColor={m.from === "larry" ? undefined : seatColor[m.from]}
                  align={m.from === "a" ? "end" : "start"}
                  quiet={faded && m.from === "larry"}
                  practice={!!persona && m.from === "b"}
                  excused={m.excused}
                  showName={!continued}
                >
                  {m.text}
                </ChatBubble>
              );
            })}
            {messages.length === 1 && !sending && !persona && (
              <p className="mt-2 hidden rounded-mini border-2 border-dashed border-line p-4 text-ink-soft lg:block">
                Tap a reply or a question below. Or tap Just us to talk without {APP_NAME}.
              </p>
            )}
            {/* Practice: one short warm nudge, no countdown. The round's cap still works, unseen. */}
            {persona && !practiceOver && messages.length > 0 && nudge && (
              <p className="mx-auto mt-1 flex items-center gap-2 rounded-full bg-paper px-4 py-1.5 text-label font-bold text-ink ring-2 ring-line">
                <Heart className="size-4 shrink-0" aria-hidden />
                {nudge}
              </p>
            )}
            {learnedNote && <LearnedNote note={learnedNote} onUndo={undoLearned} onDismiss={dismissLearned} className="sm:ml-11" />}
            {sending && (
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
                <span>{progress ?? `${APP_NAME} is thinking…`}</span>
              </p>
            )}
            <AnimatePresence>
              {faded && !away && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-auto mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-bubble bg-paper px-4 py-2 ring-2 ring-border-subtle"
                >
                  <p className="flex items-center gap-2 font-bold text-ink">
                    <Moon className="size-4 shrink-0" aria-hidden /> {FADE_TEXT}
                  </p>
                  <button type="button" onClick={wakeLarry} className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}>
                    Need {APP_NAME}?
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {!isLg && locationBlock}
            {/* The page's scroll-padding already clears the composer; this adds a little air. */}
            <div ref={bottomRef} className="scroll-mb-2" />
          </section>
          {chatError && (
            <p role="alert" className="mt-3 rounded-mini bg-paper p-3 font-bold text-danger ring-2 ring-danger">
              {chatError}
            </p>
          )}
          <p role="status" className="sr-only">
            {sending ? progress ?? `${APP_NAME} is thinking` : announce}
          </p>
        </div>
      </main>

      <div
        ref={composerRef}
        onKeyDownCapture={() => (lastActivity.current = Date.now())}
        onPointerDownCapture={() => (lastActivity.current = Date.now())}
        onInputCapture={() => (lastActivity.current = Date.now())}
        role="region"
        aria-label="Message box"
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-border-subtle bg-table px-3 pb-3 pt-2 sm:pt-3 lg:left-auto lg:right-[max(0px,calc((100vw-72rem)/2))] lg:w-[calc(28rem+2.5rem)] lg:border-t-0 lg:pl-0 lg:pr-5 max-lg:[@media(max-height:640px)]:static [@media(max-height:500px)]:static"
      >
        <div className="mx-auto max-w-3xl">
          {showEnd && ticket && endView === "ticket" ? (
            <PlanTicketView
              key={ticket.place.id}
              ticket={ticket}
              people={people}
              withPerson={other?.name}
              ownerName={owner ? me.name : undefined}
              location={location}
              picks={me.items.map((i) => i.id)}
              onCancel={practiceOver ? undefined : closeEnd}
              onOther={() => setEndView("steps")}
              onDone={() => router.push("/steps")}
            />
          ) : showEnd ? (
            <EndPanel
              steps={steps}
              suggestions={suggestions}
              withPerson={other?.name}
              ownerName={owner ? me.name : undefined}
              waiting={sending}
              canKeepTalking={!practiceOver}
              suggestInput={suggestInput}
              // The true "you both picked" items for the overlap image. Never for a practice pal.
              overlap={
                persona || !other || !(ground?.shared.length || bridges.length)
                  ? undefined
                  : { names: [a.name, b.name], shared: (ground?.shared ?? []).map((i) => i.name), bridges: bridges.map((x) => x.name) }
              }
              intro={
                persona && practiceOver
                  ? `Practice round done. Nice work, ${a.name}. Now pick one thing to try with a real person.`
                  : undefined
              }
              onCancel={closeEnd}
              onSave={(chosen) => {
                if (chosen.length) addSteps(chosen);
              }}
              onDone={() => router.push("/steps")}
            />
          ) : (
            <PromptInputBox
              speakers={speakers}
              activeSpeaker={persona ? 0 : speaker}
              onSpeakerChange={setSpeaker}
              onSend={send}
              replies={persona ? QUICK_PRACTICE : REPLIES}
              replyTo={persona || speaker === 0 ? b.name : a.name}
              larryQuestions={persona ? undefined : LARRY_QUESTIONS}
              mode={persona ? undefined : mode}
              onModeChange={setMode}
              away={!persona && away}
              onAwayChange={persona ? undefined : (v) => (v ? excuseLarry() : helloLarry())}
              justUsNote={persona ? undefined : JUST_US_NOTE}
              // Locked until Larry's opening is in, so an early tap can't race it.
              // Excused, nothing waits for Larry: the two can write to each other straight away.
              isLoading={sending || (!away && !ground && !groundError) || practiceLocked}
              // R4: typing or speaking counts as talking, so Larry's quiet-time fade waits.
              onActivity={() => (lastActivity.current = Date.now())}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** "Leave this chat?": the back arrow asks first once there is something to lose. Stay has first focus. */
function LeaveDialog({
  open,
  onOpenChange,
  unsavedStep,
  onSaveFirst,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unsavedStep: boolean;
  onSaveFirst: () => void;
  onLeave: () => void;
}) {
  const stayRef = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      initialFocus={stayRef}
      title="Leave this chat?"
      description={
        <>
          The chat is not saved on this phone.
          {unsavedStep && " Your First Step is not saved yet."}
        </>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button ref={stayRef} size="sm" onClick={() => onOpenChange(false)}>
          Stay
        </Button>
        {unsavedStep && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onSaveFirst();
            }}
          >
            Save a First Step first
          </Button>
        )}
        <Button variant="quiet" onClick={onLeave}>
          Leave
        </Button>
      </div>
    </Dialog>
  );
}

function PlacesMessage({
  places,
  people,
  onPlan,
  chosenId,
}: {
  places: (Place | PlaceCardData)[];
  people: FitPeople;
  onPlan: (p: Place | PlaceCardData) => void;
  chosenId?: string;
}) {
  return (
    <ul className="flex flex-col gap-2 sm:ml-11" aria-label={`Places nearby, found by ${APP_NAME}`}>
      {places.map((p) => {
        const isPlanned = chosenId === p.id;
        return (
          <li key={p.id}>
            <PlaceCard
              place={p}
              people={people}
              action={
                <button
                  type="button"
                  onClick={() => onPlan(p)}
                  aria-pressed={isPlanned}
                  aria-label={`${isPlanned ? "Planned" : "Plan this"}: ${p.name}`}
                  className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}
                >
                  {isPlanned ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                  {isPlanned ? "Planned" : "Plan this"}
                </button>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export default function PracticeChatPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <Pair />
    </Suspense>
  );
}
