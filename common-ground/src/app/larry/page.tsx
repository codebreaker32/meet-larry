"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, Flag, Heart, LifeBuoy, MapPinOff, Plus, Sparkles, Undo2, Users } from "lucide-react";
import { LarryAvatar } from "@/components/larry-avatar";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { HiddenGemsMoreOptions } from "@/components/hidden-gems-switch";
import { MoodPicker } from "@/components/mood-picker";
import { EndPanel, type DraftStep } from "@/components/chat/end-panel";
import { HelpDialog, type HelpHandle } from "@/components/chat/help-dialog";
import { PlaceCard, type FitPeople } from "@/components/place-card";
import { PlanTicketView } from "@/components/plan-ticket";
import { GROUP_NEW_HREF, SOLO_LABEL } from "@/components/site-header";
import { GROUP_WORD } from "@/lib/groups/shared";
import { TasteCard } from "@/components/taste-card";
import { ChatBubble } from "@/components/ui";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { HISTORY_TURNS } from "@/lib/chat-protocol";
import type { GroupChatResult, GroupTurn, Persona, PersonaUpdate, PlaceCard as PlaceCardData, PlaceVibe, PlanTicket, SuggestInput } from "@/lib/contracts";
import { CRISIS_TEXT, looksLikeCrisis } from "@/lib/crisis";
import { LOCATION_OFF_LINE, LOCATION_SETTINGS_HREF, useApproxLocation } from "@/lib/location";
import { recentPlacesField, signalsField } from "@/lib/mood";
import {
  applyPersonaUpdate,
  describePersonaUpdate,
  isEmptyUpdate,
  loadPersona,
  personaForRequest,
  personaToProfile,
  savePersona,
  undoPersonaUpdate,
  usePersona,
} from "@/lib/persona";
import { PROFILE_ITEMS_MAX } from "@/lib/schemas";
import { addSteps, useSteps, useStepsDone } from "@/lib/storage";
import { buildTicket, FALLBACK_NUDGES, fetchSuggest, nextRung, suggestSteps } from "@/lib/suggest-steps";
import { seatColorAt } from "@/lib/tokens";
import type { FirstStep, LarryEvent, Place, Profile, TasteItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageSkeleton } from "@/components/page-skeleton";

type Message =
  | { id: string; kind: "text"; from: "larry" | "me"; text: string }
  | { id: string; kind: "step"; text: string }
  | { id: string; kind: "places"; places: (Place | PlaceCardData)[] }
  /** The Plan Ticket Larry made (a real Qloo place, a daytime slot, the thing to bring up, an opener). */
  | { id: string; kind: "ticket"; ticket: PlanTicket }
  | { id: string; kind: "help" }
  /** What Larry learned this turn (merged into the persona on this phone), with Undo. */
  | { id: string; kind: "learned"; lines: string[]; update: PersonaUpdate; before: Persona; undone: boolean };

/** One-tap asks, so nobody has to type. Each one is a live Qloo lookup. Short, so they sit in one row. */
const QUICK = ["Films", "Games", "Music", "Places"];
const NUDGE_EVERY = 2;
const ME_COLOR = seatColorAt(0);

const newId = () => crypto.randomUUID();

/** The saved persona as a request carries it (read fresh, so the newest learning goes along). */
function personaFor(): Persona | undefined {
  const p = loadPersona();
  return p ? personaForRequest(p) : undefined;
}

/**
 * What Larry learned this turn: the agent's PersonaUpdate when the server sends one, plus picks it
 * added the older way (profileUpdates), minus what the persona already holds.
 */
function learnedFrom(result: GroupChatResult & { personaUpdate?: PersonaUpdate }, persona: Persona): PersonaUpdate | null {
  const u = result.personaUpdate;
  const known = new Set(persona.likes.map((l) => l.id));
  const addLikes: TasteItem[] = [];
  for (const it of [...(u?.addLikes ?? []), ...(result.profileUpdates ?? []).map((p) => p.item)]) {
    if (!known.has(it.id) && !addLikes.some((x) => x.id === it.id)) addLikes.push(it);
  }
  const lower = (s: string) => s.trim().toLowerCase();
  const update: PersonaUpdate = {
    addLikes,
    addDislikes: (u?.addDislikes ?? []).filter((d) => !persona.dislikes.some((x) => lower(x.name) === lower(d.name))),
    addNotes: (u?.addNotes ?? []).filter((n) => !persona.notes.some((x) => lower(x) === lower(n))),
    ...(u?.placeVibe && u.placeVibe !== persona.placeVibe ? { placeVibe: u.placeVibe } : {}),
  };
  return isEmptyUpdate(update) ? null : update;
}

/**
 * The words sent for "Ask Larry for one easy place" (/larry?ask=place, from First Steps). With a
 * place visit already done, it asks for the next, slightly bigger step on the ladder.
 */
function placeAsk(steps: FirstStep[] | undefined, vibe?: PlaceVibe | null): string {
  // From the Quiet-to-Lively Ladder: the rung the person is on now.
  if (vibe) return `Find me one ${vibe} place nearby for my next step on the ladder, and make it a plan.`;
  const lastGo = (steps ?? []).filter((s) => s.done && s.kind === "go").sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))[0];
  const next = lastGo ? nextRung(lastGo) : null;
  return next
    ? `Find me one easy place nearby for my next step: ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}. Make it a plan.`
    : "Find me one calm place nearby for a short first visit, and make it a plan.";
}

const VIBES: PlaceVibe[] = ["calm", "cosy", "lively"];

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
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Reads the /api/larry NDJSON stream (progress events, then done or error). */
async function readLarry(res: Response, onProgress: (text: string) => void): Promise<GroupChatResult> {
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
      const event = JSON.parse(line) as LarryEvent;
      if (event.type === "progress") onProgress(event.text);
      else if (event.type === "done") return event.result;
      else throw new Error(event.error);
    }
    if (done) break;
  }
  throw new Error(`${APP_NAME} stopped before answering. Try again.`);
}

export default function LarryPage() {
  return (
    <React.Suspense fallback={<PageSkeleton label="Opening your chat" />}>
      <LarryScreen />
    </React.Suspense>
  );
}

function LarryScreen() {
  const persona = usePersona();
  // From First Steps: start by asking Larry for one easy place nearby.
  const params = useSearchParams();
  const askPlace = params.get("ask") === "place";
  const vibeParam = params.get("vibe");
  const vibe = VIBES.find((v) => v === vibeParam) ?? null;
  if (persona === undefined) return <PageSkeleton label="Opening your chat" />;
  if (persona === null || persona.likes.length === 0) return <NeedCard />;
  return <Solo persona={persona} askPlace={askPlace} askVibe={vibe} />;
}

/** Larry finds things from your picks, so the chat needs your taste card first. */
function NeedCard() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-5 px-5 py-10">
      <Link href="/" className={cn(buttonStyles.quiet, "-ml-4")}>
        <ArrowLeft className="size-5" aria-hidden /> Home
      </Link>
      <h1 className="font-display text-title-lg font-black leading-none">{SOLO_LABEL}</h1>
      <p className="text-lead text-ink-soft">
        {APP_NAME} is an AI. It looks up things you might like from your taste card, so make your card first. It takes a
        minute, by tapping pictures.
      </p>
      <LinkButton href="/create">Make my taste card</LinkButton>
    </main>
  );
}

function Solo({ persona, askPlace: askPlaceProp, askVibe }: { persona: Persona; askPlace: boolean; askVibe: PlaceVibe | null }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const stepsDone = useStepsDone() ?? 0;
  const savedSteps = useSteps();
  // The persona is live (saved on this phone); Larry gets its top picks as the card, and all of it to learn from.
  const profile = React.useMemo(() => personaToProfile(persona, PROFILE_ITEMS_MAX), [persona]);
  const [initial] = React.useState(profile);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const historyRef = React.useRef<GroupTurn[]>([]);
  const inFlight = React.useRef(false);
  const [sending, setSending] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [announce, setAnnounce] = React.useState("");
  // D24: the coarse point stored at onboarding. Never a "share location" button here.
  const approx = useApproxLocation();
  const location = React.useMemo(
    () => (approx.location ? { lat: approx.location.lat, lon: approx.location.lon } : null),
    [approx.location],
  );
  // Read once: ?ask=place starts the chat by asking Larry for one easy place near the stored point.
  const [askPlace] = React.useState(askPlaceProp);
  const [places, setPlaces] = React.useState<(Place | PlaceCardData)[]>([]);
  // The Plan Ticket: Larry's own, or one built here from a place the person chose.
  const [ticket, setTicket] = React.useState<PlanTicket | null>(null);
  const [endView, setEndView] = React.useState<"ticket" | "steps">("ticket");
  const [steps, setSteps] = React.useState<DraftStep[]>([]);
  const [ending, setEnding] = React.useState(false);
  const [wrapped, setWrapped] = React.useState(false);
  const [userTurns, setUserTurns] = React.useState(0);
  const [nudges, setNudges] = React.useState<string[]>(FALLBACK_NUDGES);
  const helpRef = React.useRef<HelpHandle>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const finishRef = React.useRef<HTMLButtonElement>(null);
  const isLg = useMediaQuery("(min-width: 1024px)");

  const callLarry = React.useCallback(
    async (history: GroupTurn[], previous: GroupTurn[], current: Profile, at?: { lat: number; lon: number }) => {
      const loc = at ?? location;
      inFlight.current = true;
      setSending(true);
      setProgress(null);
      setError(null);
      try {
        const res = await apiFetch("/api/larry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Mood, age range and Hidden Gems go with the person's own request only.
          body: JSON.stringify({ profile: current, persona: personaFor(), history, location: loc ?? undefined, stepsDone, ...signalsField(), ...recentPlacesField() }),
        });
        const body = await readLarry(res, setProgress);
        const out = body.messages ?? [];
        historyRef.current = [...history, { role: "assistant" as const, content: out.map((m) => m.text).join("\n") || "[quiet]" }].slice(
          -HISTORY_TURNS,
        );

        const added: Message[] = out.map((m) => ({ id: newId(), kind: "text" as const, from: "larry" as const, text: m.text }));
        if (body.crisis) added.push({ id: newId(), kind: "help" });
        if (body.places?.length) {
          setPlaces(body.places);
          added.push({ id: newId(), kind: "places", places: body.places.slice(0, 3) });
        }
        const planTicket = (body as GroupChatResult & { planTicket?: PlanTicket }).planTicket;
        if (planTicket) {
          setTicket(planTicket);
          setEndView("ticket");
          added.push({ id: newId(), kind: "ticket", ticket: planTicket });
        }
        // With a Plan Ticket, its "go" step is saved from the ticket (with the time they pick), so
        // it isn't saved twice here.
        const newSteps = planTicket ? (body.steps ?? []).filter((s) => s.kind !== "go") : (body.steps ?? []);
        if (newSteps.length) {
          // Larry tells the person it saved the step on their phone, so it really is saved now.
          addSteps(newSteps);
          setSteps((s) => [...s, ...newSteps.filter((x) => !s.some((y) => y.text === x.text))]);
          for (const s of newSteps) added.push({ id: newId(), kind: "step", text: s.text });
        }
        // What Larry learned goes into the persona on this phone, shown with Undo.
        const before = loadPersona();
        const learned = before ? learnedFrom(body, before) : null;
        if (before && learned) {
          savePersona(applyPersonaUpdate(before, learned));
          added.push({ id: newId(), kind: "learned", lines: describePersonaUpdate(learned), update: learned, before, undone: false });
        }

        if (added.length) setMessages((m) => [...m, ...added]);
        const learnedLines = learned ? ` ${APP_NAME} learned: ${describePersonaUpdate(learned).join(" ")}` : "";
        if (out.length || learnedLines) setAnnounce(out.map((m) => `${APP_NAME} says: ${m.text}`).join(" ") + learnedLines);
        if (body.wrapUp) {
          setWrapped(true);
          setEnding(true);
        }
      } catch (err) {
        historyRef.current = previous;
        if (previous.length < history.length && history.at(-1)?.role === "user") setUserTurns((n) => Math.max(0, n - 1));
        setError((err as Error).message);
      } finally {
        inFlight.current = false;
        setSending(false);
        setProgress(null);
      }
    },
    [location, stepsDone],
  );

  // Larry opens once, with your card. A few short warm nudges are asked for at the same time.
  // From First Steps (?ask=place), the first turn instead asks Larry for one easy place nearby:
  // Larry looks places up with Qloo, picks one for the next step and saves it.
  const opened = React.useRef(false);
  const openChat = React.useEffectEvent(() => {
    fetchSuggest(
      { kind: "nudges", names: [initial.name], picks: initial.items.map((i) => i.name).slice(0, 12), bridges: [], places: [], ...signalsField() },
      undefined,
      undefined,
      apiFetch,
    ).then((r) => {
      if (r?.nudges.length) setNudges(r.nudges);
    });
    if (!askPlace) {
      callLarry([], [], initial);
      return;
    }
    // From First Steps: ask for one easy place. Larry uses the stored point when there is one; with
    // none it still answers from the card (and the page shows the one "places near you are off" line).
    const text = placeAsk(savedSteps, askVibe);
    const history: GroupTurn[] = [{ role: "user", content: `[${initial.name}] ${text}` }];
    setMessages([{ id: newId(), kind: "text", from: "me", text }]);
    historyRef.current = history;
    setUserTurns(1);
    callLarry(history, [], initial, location ?? undefined);
    // A reload starts a normal chat instead of asking again.
    router.replace("/larry", { scroll: false });
  });
  React.useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openChat();
  }, []);

  // Follow the chat: scroll to the page end, so the composer sits in its place right under the newest line.
  React.useEffect(() => {
    if (messages.length === 0) return;
    const id = requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" }),
    );
    return () => cancelAnimationFrame(id);
  }, [messages, sending, ending, reduce]);

  const send = (text: string) => {
    if (inFlight.current || wrapped) return;
    const line: Message = { id: newId(), kind: "text", from: "me", text };
    const previous = historyRef.current;
    const history = [...previous, { role: "user" as const, content: `[${profile.name}] ${text}` }].slice(-HISTORY_TURNS);

    // Crisis first, on the device: the fixed help reply and the helplines card. No model call.
    if (looksLikeCrisis(text)) {
      historyRef.current = [...history, { role: "assistant" as const, content: CRISIS_TEXT }].slice(-HISTORY_TURNS);
      setMessages((m) => [...m, line, { id: newId(), kind: "text", from: "larry", text: CRISIS_TEXT }, { id: newId(), kind: "help" }]);
      setAnnounce(`${APP_NAME} says: ${CRISIS_TEXT}`);
      return;
    }
    setMessages((m) => [...m, line]);
    historyRef.current = history;
    setUserTurns((n) => n + 1);
    callLarry(history, previous, profile);
  };

  const undoLearned = (id: string) => {
    const m = messages.find((x) => x.id === id);
    const now = loadPersona();
    if (!m || m.kind !== "learned" || m.undone || !now) return;
    savePersona(undoPersonaUpdate(now, m.update, m.before));
    setMessages((list) => list.map((x) => (x.id === id && x.kind === "learned" ? { ...x, undone: true } : x)));
    setAnnounce(`Undone. ${APP_NAME} forgot that.`);
  };

  // The button that opened the ticket gets focus back when it closes.
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const openTicket = (t: PlanTicket) => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTicket(t);
    setEndView("ticket");
    setEnding(true);
  };
  /** "Plan this": a Plan Ticket for this place, with one of the person's own picks to bring up. */
  const planPlace = (place: Place | PlaceCardData) => openTicket(buildTicket({ place, shared: profile.items[0] }));
  const fitPeople: FitPeople = { me: { name: profile.name, color: ME_COLOR } };

  const closeEnd = () => {
    setEnding(false);
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    requestAnimationFrame(() => (back?.isConnected ? back : finishRef.current)?.focus());
  };

  const nudge = nudges[Math.floor(userTurns / NUDGE_EVERY) % nudges.length];
  // Fixed First Steps (the fallback) and what the AI may write fresh ones from: real picks and places only.
  const suggestions = suggestSteps({ ground: null, places, me: profile, practice: true }).filter((s) => !steps.some((x) => x.text === s.text));
  const suggestInput: SuggestInput = {
    kind: "steps",
    names: [profile.name],
    picks: profile.items.map((i) => i.name).slice(0, 12),
    bridges: [],
    places: places.slice(0, 3).map((p) => ({ name: p.name, kind: p.tags[0] })),
  };
  const larryHasSpoken = messages.some((m) => m.kind === "text" && m.from === "larry");

  // D24: no "share location" button. With no stored point, one plain line pointing to Settings.
  const locationBlock = !location && (
    <p className="mt-3 flex items-start gap-2 text-label text-ink">
      <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <Link href={LOCATION_SETTINGS_HREF} className="underline decoration-2 underline-offset-4 hover:bg-paper">
        {LOCATION_OFF_LINE}
      </Link>
    </p>
  );
  // Today's mood and Hidden Gems go with every message from here on.
  const signalsBlock = (
    <div className="mt-3 flex flex-col gap-3">
      <MoodPicker compact onChange={(m) => setAnnounce(m ? `${APP_NAME} will keep your mood in mind.` : "Mood cleared.")} />
      <HiddenGemsMoreOptions description={`${APP_NAME} looks for less-known picks that fit your taste.`} />
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-table [@media(max-height:500px)]:static">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-1.5 py-2 sm:gap-2 sm:px-3 lg:px-5">
          <Link href="/" aria-label="Leave chat" className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-paper">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <p className="flex min-w-0 flex-1 items-center gap-2 font-display text-label font-black sm:text-lead">
            <LarryAvatar size="sm" decorative />
            <span className="truncate">
              <span className="max-sm:hidden">Talk taste with </span>
              {APP_NAME}
            </span>
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
            disabled={ending || !larryHasSpoken}
            className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-ink px-3.5 text-label font-bold text-paper hover:bg-ink-hover disabled:bg-paper disabled:text-ink-soft disabled:shadow-none disabled:ring-2 disabled:ring-line disabled:hover:bg-paper disabled:active:scale-100 sm:px-4"
          >
            <Flag className="size-4 max-sm:hidden" aria-hidden /> Finish
          </button>
        </div>
      </header>
      <HelpDialog ref={helpRef} />

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 lg:grid lg:max-w-6xl lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-10 lg:px-5">
        {/* Your card on the side: what Larry looks things up from. */}
        <aside className="pt-4 lg:sticky lg:top-[4.5rem] lg:pt-6">
          <div className="flex items-start gap-3 lg:flex-col lg:gap-4">
            {/* Phones: a small card, so Larry's opening still fits on the first screen. */}
            <div className="shrink-0 max-lg:-rotate-3 lg:w-full">
              <TasteCard profile={profile} total={persona.likes.length} accent={ME_COLOR} size="xs" className="lg:hidden" />
              <TasteCard profile={profile} total={persona.likes.length} accent={ME_COLOR} size="md" className="max-lg:hidden" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-title-session font-black leading-tight">{SOLO_LABEL}</h1>
              <p className="mt-1 text-label text-ink sm:text-body">
                {APP_NAME} is an AI, not a person. It finds things you might love from what real fans like, and says
                why. It learns your taste as you chat.
              </p>
              <p className="mt-1 text-label text-ink-soft sm:text-body">Chats are short on purpose. Then it points you to real people.</p>
              <Link
                href="/me"
                className="-ml-1 mt-1 inline-flex min-h-12 items-center gap-2 rounded-full px-1 pr-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4 hover:bg-paper"
              >
                <Sparkles className="size-4" aria-hidden /> Your taste, by {APP_NAME}
              </Link>
            </div>
          </div>
          {signalsBlock}
          {isLg && locationBlock}
        </aside>

        <div className="flex min-h-[60dvh] flex-col pt-4 lg:pt-6">
          <section aria-label="Chat" className="flex flex-1 flex-col gap-3 pb-4">
            {messages.map((m, i) => {
              if (m.kind === "step")
                return (
                  <p key={m.id} className="mx-auto flex max-w-full items-center gap-2 rounded-full bg-paper px-4 py-2 text-label font-bold ring-2 ring-cat-film">
                    <Flag className="size-4 shrink-0" aria-hidden /> First Step: {m.text}
                  </p>
                );
              if (m.kind === "places")
                return (
                  <ul key={m.id} className="flex flex-col gap-2 sm:ml-11" aria-label={`Places nearby, found by ${APP_NAME}`}>
                    {m.places.map((p) => {
                      const planned = ticket?.place.id === p.id;
                      return (
                        <li key={p.id}>
                          <PlaceCard
                            place={p}
                            people={fitPeople}
                            meet
                            action={
                              <button
                                type="button"
                                onClick={() => planPlace(p)}
                                aria-label={`Plan this: ${p.name}`}
                                className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}
                              >
                                {planned ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                                Plan this
                              </button>
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                );
              if (m.kind === "ticket")
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-ink bg-paper p-3 sm:ml-11">
                    <Flag className="size-5 shrink-0" aria-hidden />
                    <p className="min-w-0 flex-1 basis-48 font-bold leading-snug">
                      {APP_NAME} made a plan: {m.ticket.place.name}, {m.ticket.when}.
                    </p>
                    <button
                      type="button"
                      onClick={() => openTicket(m.ticket)}
                      className={cn(buttonStyles.primary, "min-h-12 px-4")}
                    >
                      See the plan
                    </button>
                  </div>
                );
              if (m.kind === "learned") return <Learned key={m.id} message={m} onUndo={() => undoLearned(m.id)} />;
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
              const continued = prev?.kind === "text" && prev.from === m.from;
              return (
                <ChatBubble
                  key={m.id}
                  sender={m.from === "larry" ? "larry" : "person"}
                  name={profile.name}
                  seatColor={ME_COLOR}
                  align={m.from === "larry" ? "start" : "end"}
                  showName={!continued}
                >
                  {m.text}
                </ChatBubble>
              );
            })}
            {!wrapped && userTurns > 0 && nudge && (
              <p className="mx-auto mt-1 flex items-center gap-2 rounded-full bg-paper px-4 py-1.5 text-label font-bold text-ink ring-2 ring-line">
                <Heart className="size-4 shrink-0" aria-hidden />
                {nudge}
              </p>
            )}
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
            {error && (
              <p role="alert" className="rounded-mini bg-paper p-3 font-bold text-danger ring-2 ring-danger">
                {error}
              </p>
            )}
            {!isLg && !ending && larryHasSpoken && locationBlock}
            <div ref={bottomRef} className="scroll-mb-2" />
          </section>
          <p role="status" className="sr-only">
            {sending ? (progress ?? `${APP_NAME} is thinking`) : announce}
          </p>

          <div className="sticky bottom-0 z-20 -mx-3 bg-table px-3 pb-3 pt-2 [@media(max-height:500px)]:static">
            <AnimatePresence initial={false} mode="wait">
              {ending && ticket && endView === "ticket" ? (
                <motion.div key="ticket" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <PlanTicketView
                    ticket={ticket}
                    people={fitPeople}
                    afterSave="close"
                    location={location}
                    picks={profile.items.map((i) => i.id)}
                    onOther={() => setEndView("steps")}
                    onCancel={wrapped ? undefined : closeEnd}
                    onDone={() => router.push("/steps")}
                  />
                </motion.div>
              ) : ending ? (
                <motion.div key="end" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <EndPanel
                    steps={steps}
                    suggestions={suggestions}
                    suggestInput={suggestInput}
                    waiting={sending}
                    canKeepTalking={!wrapped}
                    extra={
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-mini bg-table p-3">
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
                          <Users className="size-5" />
                        </span>
                        <p className="min-w-0 flex-1 basis-48 font-bold leading-snug">
                          {`Or talk to real people now. Start a ${GROUP_WORD.toLowerCase()} and show the QR to a friend.`}
                        </p>
                        <LinkButton href={GROUP_NEW_HREF} variant="secondary" className="min-h-12 px-4">
                          {`Start a ${GROUP_WORD.toLowerCase()}`}
                        </LinkButton>
                      </div>
                    }
                    intro={
                      wrapped
                        ? `That's our chat for now, ${profile.name}. Pick one small thing to do with real people.`
                        : "Pick one small thing to do with real people."
                    }
                    onCancel={closeEnd}
                    onSave={(chosen) => {
                      if (chosen.length) addSteps(chosen);
                    }}
                    onDone={() => router.push("/steps")}
                  />
                </motion.div>
              ) : (
                <motion.div key="composer" initial={false}>
                  <PromptInputBox
                    speakers={[{ name: profile.name, color: ME_COLOR }]}
                    activeSpeaker={0}
                    onSpeakerChange={() => {}}
                    onSend={(text) => send(text)}
                    replies={QUICK}
                    replyTo={APP_NAME}
                    repliesLabel={`Ask ${APP_NAME} about`}
                    placeholder={`Tell ${APP_NAME} what you love, or ask for ideas…`}
                    isLoading={sending || !larryHasSpoken}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * "Larry learned: ..." after a turn: easy-read lines, one tap to undo, and the way to see it all.
 * Paper with a line ring, so it reads as a note about the chat, not a chat bubble.
 */
function Learned({ message, onUndo }: { message: Extract<Message, { kind: "learned" }>; onUndo: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-mini bg-paper p-3 ring-2 ring-line sm:ml-11">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-paper">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-bold">{message.undone ? `${APP_NAME} forgot this:` : `${APP_NAME} learned:`}</p>
        <ul className={cn("text-label leading-snug", message.undone ? "text-ink-soft line-through" : "text-ink")}>
          {message.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!message.undone && (
          <button type="button" onClick={onUndo} className={cn(buttonStyles.quiet, "px-3")}>
            <Undo2 className="size-4" aria-hidden /> Undo
          </button>
        )}
        <Link href="/me" className={cn(buttonStyles.quiet, "px-3")}>
          See your taste
        </Link>
      </div>
    </div>
  );
}

