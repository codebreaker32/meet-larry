"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { ArrowLeft, Check, Clock, Flag, LifeBuoy, Loader2, MapPinOff, Plus, ShieldCheck, WifiOff } from "lucide-react";
import { BridgeCard, BridgeCardSkeleton } from "@/components/bridge-card";
import { HiddenGemsMoreOptions } from "@/components/hidden-gems-switch";
import { buttonStyles } from "@/components/link-button";
import { MoodPicker } from "@/components/mood-picker";
import { LarryAvatar } from "@/components/larry-avatar";
import { HelpDialog, type HelpHandle } from "@/components/chat/help-dialog";
import { BlockReport } from "@/components/safety/block-report";
import { PlaceCard, type FitPeople } from "@/components/place-card";
import { Poster } from "@/components/taste-card";
import { ChatBubble } from "@/components/ui";
import { type ComposerMode, PromptInputBox } from "@/components/ui/ai-prompt-box";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import type { GroupBridge, PlaceCard as PlaceCardData, PlanTicket, Room, RoomCredentials, RoomMember, RoomMessage } from "@/lib/contracts";
import { looksLikeCrisis } from "@/lib/crisis";
import { LOCATION_OFF_LINE, LOCATION_SETTINGS_HREF, useApproxLocation } from "@/lib/location";
import { addSteps, isSameOpenStep, useSteps } from "@/lib/storage";
import { buildTicket, DO_TOGETHER, fetchSuggest, firstVisit } from "@/lib/suggest-steps";
import { signalsField } from "@/lib/mood";
import type { FirstStep, Place } from "@/lib/types";
import { useHeightVar } from "@/lib/use-height-var";
import { cn } from "@/lib/utils";
import { addressedMember } from "./addressed";
import { SharedPickCard } from "./shared-pick-card";
import { LearnedNote, usePersonaLearning } from "./larry-learned";
import { MemberRow } from "./member-card";
import {
  forgetCredentials,
  getRoom,
  leaveRoom,
  postMessage,
  RoomError,
  setLarryAway,
  touchCredentials,
} from "./room-api";
import { FadeChip, GroupStepCard, type LarryMove, MoveTag, RoomEvent, TypingRow } from "./room-chat";
import { type DraftStep, FinishDialog, LeaveDialog } from "./room-finish";
import { joinNames, seatColor } from "@/lib/seats";

const POLL_MS = 1500;
/** Failed polls in a row before "Reconnecting" shows (one blip is not worth a message). */
const FAILS_BEFORE_NOTICE = 3;
/** One-tap replies to the group. "Me too" is the group's easiest way in. */
const REPLIES = ["Yes", "Me too", "Tell me more", "Not for me"];
/** Questions for Larry: each one is a live Qloo lookup for the whole group. */
const LARRY_QUESTIONS = ["What do we all like?", "What could we do together?", "Give us a game for the group", "Help us pick a plan"];
const PLAN_QUESTION = "Help us pick one real thing to do together";
const START_QUESTION = "Hi Larry! Can you help us get started?";
/** Larry steps back after this many "Just us" messages in a row. */
const JUST_US_LIMIT = 3;
/** Shown once per device, the first time someone taps "Just us". */
const JUST_US_NOTE = `Just you now. ${APP_NAME} is listening, not replying.`;
/** Common-ground cards shown before "Show more": bridges on wide screens, any card on phones. */
const BRIDGES_SHOWN = 4;
const CARDS_SHOWN_PHONE = 2;
/** After this long without common ground, say Qloo is slow instead of showing a spinner. */
const GROUND_SLOW_MS = 20_000;

const stepKey = (s: { kind: string; text: string }) => `${s.kind}:${s.text}`;

/** A room may carry Larry's Plan Ticket for the group (set by the agent with its places). */
type RoomWithPlan = Room & { planTicket?: PlanTicket; places?: (Place | PlaceCardData)[] };

interface Pending {
  id: string;
  text: string;
  toLarry: boolean;
  at: number;
  /** How many of my messages with these words the room had when this was sent. */
  base: number;
}

type TimelineItem =
  | { key: string; at: number; kind: "message"; message: RoomMessage }
  | { key: string; at: number; kind: "pending"; pending: Pending }
  | { key: string; at: number; kind: "step"; step: DraftStep }
  | { key: string; at: number; kind: "joined"; member: RoomMember; first: boolean };

/** Polls the room every POLL_MS while the tab is visible; returns the latest room and its health. */
function useRoomPoll(creds: RoomCredentials, onGone: () => void) {
  const { code } = creds;
  const credsRef = React.useRef(creds);
  const [room, setRoom] = React.useState<Room | null>(null);
  const [offline, setOffline] = React.useState(false);
  const versionRef = React.useRef<number | undefined>(undefined);
  const onGoneRef = React.useRef(onGone);
  React.useEffect(() => {
    onGoneRef.current = onGone;
    credsRef.current = creds;
  });

  /** Takes a room from a poll or a POST reply, never going back to an older version. */
  // Steps carry no time, so each one is placed in the chat after Larry's reply that brought it:
  // the latest Larry message when this phone first sees the step.
  const [stepAt, setStepAt] = React.useState<Record<string, number>>({});
  const apply = React.useCallback((next: Room) => {
    if (versionRef.current !== undefined && next.version < versionRef.current) return;
    versionRef.current = next.version;
    setRoom(next);
    setStepAt((prev) => {
      const fresh = next.steps.map(stepKey).filter((k) => !(k in prev));
      if (!fresh.length) return prev;
      const larryAt = next.messages.findLast((m) => m.from === "larry")?.at ?? next.messages.at(-1)?.at ?? 0;
      return { ...prev, ...Object.fromEntries(fresh.map((k) => [k, larryAt])) };
    });
  }, []);

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let fails = 0;
    let ctrl: AbortController | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(tick, POLL_MS);
    };
    async function tick() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      ctrl = new AbortController();
      try {
        const out = await getRoom(code, versionRef.current, ctrl.signal, credsRef.current);
        fails = 0;
        setOffline(false);
        if ("room" in out) apply(out.room);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (err instanceof RoomError && err.status === 404) {
          stopped = true;
          onGoneRef.current();
          return;
        }
        // This phone isn't a member any more (removed after a long time away): back to joining.
        if (err instanceof RoomError && (err.status === 401 || err.status === 403)) {
          stopped = true;
          forgetCredentials(code);
          return;
        }
        fails += 1;
        if (fails >= FAILS_BEFORE_NOTICE) setOffline(true);
      } finally {
        inFlight = false;
        schedule();
      }
    }
    // Paused while the tab is hidden; back at once when it shows again.
    const onVisible = () => {
      if (document.hidden) clearTimeout(timer);
      else if (!inFlight) tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, apply]);

  return { room, apply, offline, stepAt };
}

export function LiveRoom({ creds, onGone }: { creds: RoomCredentials; onGone: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { code, memberId } = creds;
  const { room, apply, offline, stepAt } = useRoomPoll(creds, onGone);
  // The header and composer mount with the room, so their heights are measured from then.
  const headerRef = React.useRef<HTMLElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  useHeightVar(headerRef, "--header-h", !!room);
  useHeightVar(composerRef, "--composer-h", !!room);

  const [pending, setPending] = React.useState<Pending[]>([]);
  const [asking, setAsking] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [helpAt, setHelpAt] = React.useState<number[]>([]); // crisis moments on this phone
  const [mode, setMode] = React.useState<ComposerMode>("larry");
  /** "Excuse Larry" / "Hello Larry" from this phone, shown at once until the room confirms it. */
  const [awayWish, setAwayWish] = React.useState<boolean | null>(null);
  /** "Need Larry?" wakes Larry: the "Just us" run only counts messages after this one. */
  const [wokeAfter, setWokeAfter] = React.useState<string | null>(null);
  const [showAllBridges, setShowAllBridges] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  // D24: the coarse point stored at onboarding. Never a "share location" button here.
  const approx = useApproxLocation();
  const location = React.useMemo(
    () => (approx.location ? { lat: approx.location.lat, lon: approx.location.lon } : null),
    [approx.location],
  );
  /** AI-written group ideas for Finish when Larry hasn't picked a step: "idle" until asked, "loading", or null on failure. */
  const [aiIdeas, setAiIdeas] = React.useState<DraftStep[] | null | "idle" | "loading">("idle");
  const aiAsked = React.useRef<string | null>(null);
  // The place someone tapped "Plan this" on: Finish then opens on a Plan Ticket for it.
  const [chosenPlace, setChosenPlace] = React.useState<Place | PlaceCardData | null>(null);
  // This phone's person: Larry gets their persona when asked, and what it learns comes back here.
  const learning = usePersonaLearning();

  const bottomRef = React.useRef<HTMLDivElement>(null);
  const helpRef = React.useRef<HelpHandle>(null);
  const [dialog, setDialog] = React.useState<"invite" | "finish" | "leave" | null>(null);
  const dialogChange = (name: "invite" | "finish" | "leave") => (open: boolean) =>
    setDialog((d) => (open ? name : d === name ? null : d));
  const storedSteps = useSteps();

  React.useEffect(() => touchCredentials(code), [code]);

  // Not in the member list any more (left on another tab, or removed): back to the join screen.
  const removed = !!room && !room.members.some((m) => m.id === memberId);
  React.useEffect(() => {
    if (removed) forgetCredentials(code);
  }, [removed, code]);

  const members: RoomMember[] = React.useMemo(
    () => (room?.members ?? []).map((m) => ({ ...m, color: seatColor(room?.members ?? [], m.id) })),
    [room?.members],
  );
  const me = members.find((m) => m.id === memberId);
  const others = members.filter((m) => m.id !== memberId);
  const together = members.length >= 2;
  // Open to meet: two people who waved at the same public venue. No invites, no excusing Larry
  // (it watches for red flags), no location: the only place is the venue they are at.
  const meet = room?.meet;
  // Everyone Block and Report can reach: the others here, and in a meet chat anyone who left.
  const safetyPeople = React.useMemo(
    () => [
      ...others.map((o) => ({ id: o.id, name: o.name, left: false })),
      ...(meet?.left ?? []).filter((l) => l.id !== memberId && !others.some((o) => o.id === l.id)).map((l) => ({ ...l, left: true })),
    ],
    [others, meet?.left, memberId],
  );
  const larryBusy = !!room?.larryBusy || asking;
  const messages = React.useMemo(() => room?.messages ?? [], [room?.messages]);
  // Room-wide: when anyone excuses Larry, every phone shows it, and the server keeps Larry out.
  const away = awayWish ?? !!room?.larryAway;
  const larryBackAt = room?.larryBackAt;

  // Common ground normally lands in a few seconds. When Qloo is busy the server keeps trying;
  // after a while say so plainly instead of spinning.
  const waitingGround = together && !room?.ground;
  const groundWaitKey = members.map((m) => m.id).join(",");
  const [slowFor, setSlowFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!waitingGround) return;
    const t = setTimeout(() => setSlowFor(groundWaitKey), GROUND_SLOW_MS);
    return () => clearTimeout(t);
  }, [waitingGround, groundWaitKey]);
  const groundSlow = waitingGround && slowFor === groundWaitKey;

  // Messages sent from this phone show at once; each one hides when the room has it.
  const visiblePending = pending.filter(
    (p) => messages.filter((m) => m.from === memberId && m.text === p.text).length <= p.base,
  );

  // Larry's group moves: who each Larry message turns to. "Inviting in" when it's the person who
  // has said the least so far (counted up to that message), so the move is visible to everyone.
  const moves = React.useMemo(() => {
    const out = new Map<string, LarryMove>();
    const said = new Map<string, number>();
    for (const m of messages) {
      if (m.from !== "larry") {
        said.set(m.from, (said.get(m.from) ?? 0) + 1);
        continue;
      }
      const asked = addressedMember(m.text, members);
      if (!asked) continue;
      const counts = members.map((x) => said.get(x.id) ?? 0);
      const mine = said.get(asked.id) ?? 0;
      const quietest = members.length > 2 && mine === Math.min(...counts) && mine < Math.max(...counts);
      out.set(m.id, { kind: quietest ? "invite" : "ask", member: asked, isMe: asked.id === memberId });
    }
    return out;
  }, [messages, members, memberId]);

  // Did Larry's latest message ask me? Then my one-tap replies answer it. Not while Larry is
  // excused (it can't see an answer), and not for a question from before Larry's last hello
  // (Larry started fresh and no longer has it).
  const lastLarry = [...messages].reverse().find((m) => m.from === "larry");
  const lastMine = [...messages].reverse().find((m) => m.from === memberId);
  const askedMe =
    !away &&
    !!lastLarry &&
    !(larryBackAt && lastLarry.at < larryBackAt) &&
    !!moves.get(lastLarry.id)?.isMe &&
    (!lastMine || lastMine.at < lastLarry.at);

  // The fade: a run of "Just us" messages after Larry's last word means the group is talking.
  // Excused messages and anything from before Larry's last hello don't count: Larry starts fresh.
  const faded = React.useMemo(() => {
    if (away) return false;
    // Larry can only step back once it has said something.
    if (!messages.some((m) => m.from === "larry")) return false;
    let start = 0;
    if (wokeAfter) start = messages.findIndex((m) => m.id === wokeAfter) + 1;
    let run = 0;
    for (let i = messages.length - 1; i >= start; i--) {
      const m = messages[i];
      if (m.from === "larry" || m.toLarry || m.excused || (larryBackAt && m.at < larryBackAt)) break;
      run++;
    }
    return run >= JUST_US_LIMIT;
  }, [messages, wokeAfter, away, larryBackAt]);

  // Screen readers hear new lines from Larry and the others, not their own.
  const [announce, setAnnounce] = React.useState("");
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!room) return;
    if (!seen.current) {
      seen.current = new Set(room.messages.map((m) => m.id));
      return;
    }
    const fresh = room.messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    const heard = fresh.filter((m) => m.from !== memberId);
    if (heard.length) {
      const name = (id: string) => (id === "larry" ? APP_NAME : (room.members.find((x) => x.id === id)?.name ?? "Someone"));
      setAnnounce(heard.map((m) => `${name(m.from)} says: ${m.text}`).join(" "));
    }
  }, [room, memberId]);

  // Follow the conversation as it grows, but not on first load: the room and its common ground
  // come first on a phone.
  const timelineLength = messages.length + visiblePending.length + helpAt.length + (room?.steps.length ?? 0);
  const loaded = !!room;
  const last = React.useRef<{ length: number; busy: boolean } | null>(null);
  React.useEffect(() => {
    if (!loaded) return;
    const prev = last.current;
    last.current = { length: timelineLength, busy: larryBusy };
    if (!prev || (timelineLength <= prev.length && (!larryBusy || prev.busy))) return;
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [loaded, timelineLength, larryBusy, reduce]);

  const send = async (text: string, toLarryChosen: boolean) => {
    // Crisis words always reach Larry, whatever the mode and even while Larry is replying: the
    // server answers with the fixed help reply (no lock, no model call), and this phone shows the
    // helplines card straight away. A crisis line is never dropped.
    // Excused, nothing reaches Larry: the line is kept for the people only (the server enforces
    // it too), and crisis words get the helplines card on this phone, with no Larry reply.
    const excused = away;
    const crisis = looksLikeCrisis(text);
    const toLarry = !excused && (toLarryChosen || crisis);
    const now = Date.now();
    if (crisis) setHelpAt((h) => [...h, now + 1]);
    if (toLarry && larryBusy && !crisis) return;
    const p: Pending = {
      id: crypto.randomUUID(),
      text,
      toLarry,
      at: now,
      base: messages.filter((m) => m.from === memberId && m.text === text).length,
    };
    setPending((list) => [...list, p]);
    setSendError(null);
    // A crisis line gets the fixed reply at once; no Larry run starts.
    const asksLarry = toLarry && !crisis;
    if (asksLarry) {
      setAsking(true);
      setWokeAfter(null);
    }
    try {
      // A meet chat is with a stranger: the persona (notes, routines) never goes with it.
      const out = await postMessage(creds, text, toLarry, toLarry ? (location ?? undefined) : undefined, excused, meet ? null : learning.persona);
      apply(out.room);
      if (out.personaUpdate) learning.learn(out.personaUpdate);
      // The server's check reads the cleaned text too: show the helplines if it found what this phone missed.
      if (out.crisis && !crisis) setHelpAt((h) => [...h, Date.now()]);
    } catch (err) {
      const e = err as RoomError;
      if (e.status === 401 || e.status === 403) forgetCredentials(code);
      else if (e.status === 404) onGone();
      else setSendError(`${e.message} Your message was not sent.`);
    } finally {
      setPending((list) => list.filter((x) => x.id !== p.id));
      if (asksLarry) setAsking(false);
    }
  };

  /** "Excuse Larry" (away) or "Hello Larry" (back), for the whole room. */
  const changeAway = (next: boolean) => {
    setAwayWish(next);
    setSendError(null);
    if (!next) {
      setWokeAfter(null);
      setMode("larry");
    }
    setLarryAway(creds, next)
      .then((out) => apply(out.room))
      .catch((err: RoomError) => {
        if (err.status === 401 || err.status === 403) forgetCredentials(code);
        else if (err.status === 404) onGone();
        else setSendError(`${err.message} ${next ? `${APP_NAME} is still here.` : `${APP_NAME} is still out.`}`);
      })
      .finally(() => setAwayWish(null));
  };

  const wakeLarry = () => {
    setWokeAfter(messages.at(-1)?.id ?? null);
    setMode("larry");
    setAnnounce(`${APP_NAME} is listening again.`);
  };

  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    // Go first; the server call finishes in the background, then this phone forgets the room.
    router.push("/");
    leaveRoom(creds).catch(() => {});
  };

  // Group First Steps: Larry's picks, with everyone else in the room as the people to do it with.
  const withOthers = React.useMemo(() => joinNames(members.filter((m) => m.id !== memberId).map((o) => o.name)), [members, memberId]);
  // A server-side "with" that names this person is replaced by the others' names.
  const myName = me?.name;
  const roomSteps: DraftStep[] = React.useMemo(() => {
    const mine = myName ? new RegExp(`\\b${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
    return (room?.steps ?? []).map((s) => ({
      ...s,
      withPerson: (s.withPerson && !mine?.test(s.withPerson) ? s.withPerson : withOthers) || undefined,
    }));
  }, [room?.steps, myName, withOthers]);
  const isSaved = (s: DraftStep) =>
    !!storedSteps?.some((x: FirstStep) => isSameOpenStep(x, s) || (x.done && x.text.trim().toLowerCase() === s.text.trim().toLowerCase()));
  const unsavedCount = roomSteps.filter((s) => !isSaved(s)).length;

  const ground = room?.ground;
  // Larry's curated order (best first) is kept; only Qloo's own fallback list is sorted by affinity.
  const bridges: GroupBridge[] = React.useMemo(() => (ground?.curated ? [...(ground.bridges ?? [])] : [...(ground?.bridges ?? [])].sort((x, y) => y.affinity - x.affinity)), [ground]);
  const shared = ground?.shared ?? [];
  // Fixed ideas from the real common ground, for when Larry hasn't picked a step.
  const fallbackSteps: DraftStep[] = [];
  if (bridges[0]) fallbackSteps.push({ kind: "show", text: DO_TOGETHER[bridges[0].domain](bridges[0].name), withPerson: withOthers || undefined });
  if (shared[0]) fallbackSteps.push({ kind: "say", text: `Ask the group what they love about ${shared[0].item.name}`, withPerson: withOthers || undefined });
  const places = (room as RoomWithPlan | null)?.places ?? [];
  if (places[0]) fallbackSteps.push({ ...firstVisit(places[0].name), withPerson: withOthers || undefined });
  // No common ground yet (Qloo busy): a real pick from someone else's card.
  const otherPick = others.flatMap((o) => o.profile.items.slice(0, 1).map((item) => ({ o, item })))[0];
  if (!fallbackSteps.length && otherPick) {
    fallbackSteps.push({ kind: "say", text: `Ask ${otherPick.o.name} what they love about ${otherPick.item.name}`, withPerson: otherPick.o.name });
  }

  // Fresh, AI-written ideas grounded in the room's real picks, bridges and places. Asked for once
  // per set of picks and ground, only when someone opens Finish and Larry hasn't picked a step.
  const openFinish = () => {
    setDialog("finish");
    if (roomSteps.length > 0 || !together) return;
    const input = {
      kind: "steps" as const,
      // This phone's person first: ideas are written for them, never "with" themselves.
      names: [...(me ? [me.name] : []), ...others.map((m) => m.name)],
      picks: [...shared.map((x) => x.item.name), ...members.flatMap((m) => m.profile.items.map((i) => i.name))]
        .filter((n, i, all) => all.indexOf(n) === i)
        .slice(0, 12),
      bridges: bridges.slice(0, 6).map((b) => b.name),
      places: places.slice(0, 3).map((p) => ({ name: p.name, ...(p.tags?.[0] ? { kind: p.tags[0] } : {}) })),
    };
    const key = JSON.stringify(input);
    if (aiAsked.current === key) return;
    aiAsked.current = key;
    setAiIdeas("loading");
    fetchSuggest({ ...input, ...signalsField() }, undefined, 9000, apiFetch).then((r) =>
      setAiIdeas(
        r?.steps.length
          ? r.steps.slice(0, 3).map((x) => ({
              kind: x.kind,
              text: x.text.trim().slice(0, 140),
              withPerson: withOthers || undefined,
              ...(x.kind === "go" ? { rung: 0 } : {}),
            }))
          : null,
      ),
    );
  };
  const finishIdeas = Array.isArray(aiIdeas) && aiIdeas.length ? aiIdeas : fallbackSteps;

  // The Plan Ticket for Finish: Larry's for the group, unless someone here chose another place;
  // then one built on this phone from that place and the group's best bridge.
  const people: FitPeople = React.useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, { name: m.id === memberId ? `${m.name} (you)` : m.name, color: m.color }])),
    [members, memberId],
  );
  const roomTicket = (room as RoomWithPlan | null)?.planTicket;
  const ticket = React.useMemo<PlanTicket | null>(() => {
    if (roomTicket && (!chosenPlace || chosenPlace.id === roomTicket.place.id)) return roomTicket;
    if (!chosenPlace) return null;
    return buildTicket({ place: chosenPlace, bridge: bridges[0], shared: ground?.shared[0]?.item });
  }, [roomTicket, chosenPlace, bridges, ground]);

  const ideasLoading = aiIdeas === "loading";

  // One timeline: messages, joins, this phone's unsent lines and help cards, by time.
  const timeline: TimelineItem[] = React.useMemo(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({ key: m.id, at: m.at, kind: "message" as const, message: m })),
      ...members.map((m, i) => ({ key: `join-${m.id}`, at: m.joinedAt, kind: "joined" as const, member: m, first: i === 0 })),
      // Not in the room yet: always last, in the order sent (the sort is stable).
      // Just after the Larry reply that brought it (Larry's lines share one time).
      ...roomSteps.map((st) => ({ key: `step-${stepKey(st)}`, at: (stepAt[stepKey(st)] ?? 0) + 0.5, kind: "step" as const, step: st })),
      ...visiblePending.map((p) => ({ key: p.id, at: Number.MAX_SAFE_INTEGER, kind: "pending" as const, pending: p })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [messages, members, visiblePending, roomSteps, stepAt]);

  if (!room) {
    return (
      <main id="main" className="flex flex-1 items-center justify-center gap-2 px-5 text-ink-soft" role="status">
        <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> Opening the chat…
      </main>
    );
  }

  const groundBlock = together && (
    <section aria-labelledby="ground-title" className="mt-6">
      <h2 id="ground-title" className="font-display text-title-session font-black leading-tight">
        Your group&apos;s common ground
      </h2>
      {!ground && groundSlow ? (
        <p role="status" className="mt-2 flex max-w-measure items-start gap-2 text-ink">
          <Clock className="mt-1 size-4 shrink-0" aria-hidden />
          <span>
            {APP_NAME}&apos;s a little busy right now, so this is taking longer. It will keep trying. Meanwhile, ask each other about your
            cards.
          </span>
        </p>
      ) : !ground ? (
        <>
          <p role="status" className="mt-2 flex items-center gap-2 text-ink-soft">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is digging through your cards for what you share…
          </p>
          <ul className="mt-3 flex flex-col gap-3 lg:grid lg:grid-cols-2" aria-hidden>
            {[0, 1].map((i) => (
              <li key={i}>
                <BridgeCardSkeleton />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-1 text-ink-soft">
            {[
              shared.length ? `${shared.length} picked by more than one of you.` : null,
              bridges.length ? `${bridges.length} you might all love, found by ${APP_NAME}.` : null,
            ]
              .filter(Boolean)
              .join(" ") || `${APP_NAME} didn't find a strong match this time. Ask each other about your cards!`}
          </p>
          {shared.length > 0 && (
            <div className="mt-3 hidden flex-wrap items-center gap-2 lg:flex">
              {shared.map((s) => (
                <span key={s.item.id} className="flex items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 font-bold ring-2 ring-ink">
                  <Poster item={s.item} className="size-8 rounded-full border-2" sizes="32px" />
                  {s.item.name}
                  <span className="sr-only">. Picked by {joinNames(s.memberIds.map((id) => members.find((m) => m.id === id)?.name ?? ""))}.</span>
                </span>
              ))}
            </div>
          )}
          {/* Phones: a stack of cards (Qloo's bridges, best first, then shared picks), the first two
              shown. Wide screens: shared picks are the chips above, and bridges sit two to a row. */}
          {(bridges.length > 0 || shared.length > 0) && (
            <ul id="ground-cards" className="mt-3 flex flex-col gap-3 lg:grid lg:grid-cols-2">
              {bridges.map((b, i) => (
                <li
                  key={b.id}
                  className={cn(
                    !showAllBridges && i >= CARDS_SHOWN_PHONE && "max-lg:hidden",
                    !showAllBridges && i >= BRIDGES_SHOWN && "lg:hidden",
                  )}
                >
                  <BridgeCard bridge={b} people={members} best={i === 0 && b.affinity > 0} />
                </li>
              ))}
              {shared.map((s, i) => (
                <li key={s.item.id} className={cn("lg:hidden", !showAllBridges && bridges.length + i >= CARDS_SHOWN_PHONE && "hidden")}>
                  <SharedPickCard item={s.item} memberIds={s.memberIds} members={members} />
                </li>
              ))}
            </ul>
          )}
          {shared.length + bridges.length > CARDS_SHOWN_PHONE && (
            <button
              type="button"
              onClick={() => setShowAllBridges((v) => !v)}
              aria-expanded={showAllBridges}
              aria-controls="ground-cards"
              className="press press-flat mt-1 min-h-12 rounded-full px-4 font-bold underline decoration-2 underline-offset-4 hover:bg-paper lg:hidden"
            >
              {showAllBridges ? "Show fewer" : `Show ${shared.length + bridges.length - CARDS_SHOWN_PHONE} more`}
            </button>
          )}
          {bridges.length > BRIDGES_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAllBridges((v) => !v)}
              aria-expanded={showAllBridges}
              aria-controls="ground-cards"
              className="press press-flat mt-1 hidden min-h-12 rounded-full px-4 font-bold underline decoration-2 underline-offset-4 hover:bg-paper lg:block"
            >
              {showAllBridges ? "Show fewer" : `Show ${bridges.length - BRIDGES_SHOWN} more`}
            </button>
          )}
        </>
      )}
    </section>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header ref={headerRef} className="sticky top-0 z-30 border-b-2 border-ink bg-table [@media(max-height:500px)]:static">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-1.5 py-2 sm:px-3 lg:max-w-6xl lg:px-5">
          <Link href="/" aria-label="Back home. You stay in this chat." className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-paper">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          {meet ? (
            <p className="flex min-h-12 min-w-0 flex-1 items-center gap-2 sm:px-2">
              <ShieldCheck className="size-5 shrink-0 max-sm:hidden" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-display text-lead font-black leading-tight max-sm:sr-only">Open to meet</span>
                {/* On phones only the venue shows, on up to two lines, so nothing is cut off. */}
                <span className="line-clamp-2 break-words text-label font-bold leading-tight sm:truncate sm:text-caption sm:font-normal sm:text-ink-soft">
                  {meet.venueName}
                </span>
              </span>
            </p>
          ) : (
            <p className="flex min-h-12 min-w-0 flex-1 items-center gap-2 font-display text-lead font-black sm:px-2">Chat</p>
          )}
          {meet && <HeaderSafety creds={creds} people={safetyPeople} />}
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
            type="button"
            onClick={openFinish}
            hidden={!together && roomSteps.length === 0}
            className="press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-ink px-3.5 text-label font-bold text-paper hover:bg-ink-hover sm:px-4"
          >
            <Flag className="size-4 max-sm:hidden" aria-hidden /> Finish
          </button>
        </div>
      </header>
      <HelpDialog ref={helpRef} />
      <FinishDialog
        open={dialog === "finish"}
        onOpenChange={dialogChange("finish")}
        ticket={together ? ticket : null}
        people={people}
        withPerson={withOthers || undefined}
        steps={roomSteps}
        fallback={finishIdeas}
        ideasLoading={ideasLoading}
        isSaved={isSaved}
        onSave={(s) => addSteps(s)}
        larryBusy={larryBusy}
        canAskLarry={together}
        larryAway={away}
        onAskLarry={() => send(PLAN_QUESTION, true)}
        onLeave={() => setDialog("leave")}
      />
      <LeaveDialog
        open={dialog === "leave"}
        onOpenChange={dialogChange("leave")}
        unsaved={unsavedCount}
        onLeave={leave}
        leaving={leaving}
      />

      <main id="main"
        // Room for the fixed composer. On wide screens it goes under the chat column instead, so the
        // sticky left column can reach the bottom of the page.
        className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(var(--composer-h)+1.5rem)] lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start lg:gap-10 lg:px-5 lg:pb-0"
      >
        {/* The table: who is here, how to get in, and what the group shares. */}
        <section
          aria-labelledby="room-title"
          className="pt-4 lg:sticky lg:top-[var(--header-h)] lg:max-h-[calc(100dvh-var(--header-h))] lg:overflow-y-auto lg:pb-6"
        >
          <h1 id="room-title" className="font-display text-title-session font-black leading-tight">
            {meet ? "You both waved" : together ? `${members.length} of you in the room` : "Waiting for others"}
          </h1>
          <p className="mt-0.5 text-ink-soft">
            {APP_NAME} is an AI. It helps everyone have a turn, then steps back.
          </p>

          {meet && (
            <div className="mt-4 rounded-panel border-2 border-ink bg-paper p-4 sm:p-5">
              <p className="font-bold">Meet only at {meet.venueName}, in the public area.</p>
              {meet.shared.length > 0 && <p className="mt-1">You both like {joinNames(meet.shared.slice(0, 3))}.</p>}
              <p className="mt-1 text-ink-soft">
                You don&apos;t have to share your number or where you live. You can leave, block or report at any time.
              </p>
            </div>
          )}

          {!together && !meet && (
            <div className="mt-4 rounded-panel border-2 border-ink bg-paper p-4 sm:p-5">
              <p className="mb-4 flex items-center gap-2 font-bold" role="status">
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                {others.length === 0 && members.length <= 1
                  ? "You're the first one here."
                  : "Waiting for someone to join."}
              </p>
              <button type="button" onClick={() => setDialog("leave")} className={cn(buttonStyles.quiet, "mt-3 -ml-4")}>
                Leave the chat
              </button>
            </div>
          )}

          <h2 className="mt-5 font-bold">
            Who&apos;s here
            {!meet && <span className="font-normal text-ink-soft"> ({members.length} of 5)</span>}
          </h2>
          <MemberRow members={members} meId={memberId} seats={meet ? members.length : undefined} className="mt-2" />
          {/* Block or report anyone who is or was here: permanent, both ways, and they aren't told. */}
          {safetyPeople.length > 0 && (
            <ul aria-label="Block or report" className="mt-3 flex flex-wrap items-center gap-2">
              {safetyPeople.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <BlockReport target={{ room: creds, targetMemberId: o.id }} who={o.name} />
                  {(safetyPeople.length === 1 || o.left) && (
                    <span className="text-ink-soft">
                      Block or report {o.name}
                      {o.left ? " (left the chat)" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* A meet room shows what the two share above; the board appears only once Qloo has it. */}
          {(!meet || ground) && groundBlock}

          {together && !meet && (
            // This phone's mood and Hidden Gems go with its own asks to Larry. Nobody else sees them.
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <HiddenGemsMoreOptions description={`When you ask, ${APP_NAME} leans to less-known picks.`} />
                <MoodPicker compact />
              </div>
              {!location && (
                // D24: no "share location" button. One plain line pointing to Settings.
                <p className="flex items-start gap-2 text-label text-ink">
                  <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <Link href={LOCATION_SETTINGS_HREF} className="underline decoration-2 underline-offset-4 hover:bg-paper">
                    {LOCATION_OFF_LINE}
                  </Link>
                </p>
              )}
            </div>
          )}

          {together && places.length > 0 && (
            <section aria-labelledby="room-places-title" className="mt-5">
              <h2 id="room-places-title" className="font-display text-title-sm font-black leading-tight">
                Places nearby
              </h2>
              <p className="mt-0.5 text-ink-soft">{APP_NAME} found these for you, from what you all like.</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {places.slice(0, 4).map((p) => {
                  const chosen = ticket?.place.id === p.id;
                  return (
                    <li key={p.id}>
                      <PlaceCard
                        place={p}
                        people={people}
                        className="h-full"
                        action={
                          <button
                            type="button"
                            onClick={() => {
                              setChosenPlace(p);
                              openFinish();
                            }}
                            aria-label={`Plan this: ${p.name}`}
                            className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}
                          >
                            {chosen ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                            Plan this
                          </button>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </section>

        {/* The shared chat. Each person posts from their own phone. */}
        <div className="lg:pb-[calc(var(--composer-h)+1.5rem)] lg:pt-6">
          {!together && <HowItWorks />}
          <section
            aria-label="Room chat"
            className={cn(
              "-mx-3 mt-4 flex flex-col gap-3 rounded-panel px-3 py-3 transition-colors duration-(--dur-deal) lg:mt-0",
              faded ? "bg-line" : "bg-transparent",
            )}
          >
            {timeline.map((item, i) => {
              if (item.kind === "joined")
                return (
                  <RoomEvent
                    key={item.key}
                    color={item.member.color}
                    text={
                      item.member.id === memberId
                        ? item.first
                          ? "You made the room."
                          : "You joined."
                        : item.first
                          ? `${item.member.name} made the room.`
                          : `${item.member.name} joined.`
                    }
                  />
                );
              if (item.kind === "step")
                return (
                  <GroupStepCard
                    key={item.key}
                    kind={item.step.kind}
                    text={item.step.text}
                    forNames={item.step.withPerson ?? "the group"}
                    saved={isSaved(item.step)}
                    onSave={() => addSteps([item.step])}
                  />
                );
              if (item.kind === "pending")
                return (
                  <ChatBubble
                    key={item.key}
                    sender="person"
                    name="You"
                    initial={me?.name}
                    seatColor={me?.color}
                    align="end"
                    avatar="hide-on-phone"
                    toLarry={item.pending.toLarry}
                    excused={away}
                    footer="Sending…"
                  >
                    {item.pending.text}
                  </ChatBubble>
                );
              const m = item.message;
              const prev = timeline[i - 1];
              const continued =
                m.from === "larry" && prev?.kind === "message" && prev.message.from === "larry";
              const isLarry = m.from === "larry";
              const isMe = m.from === memberId;
              const member = members.find((x) => x.id === m.from);
              const move = moves.get(m.id);
              return (
                <ChatBubble
                  key={item.key}
                  sender={isLarry ? "larry" : "person"}
                  name={isMe ? "You" : (member?.name ?? "Someone who left")}
                  initial={member?.name ?? "?"}
                  seatColor={member?.color}
                  align={isMe ? "end" : "start"}
                  avatar={isMe ? "hide-on-phone" : "show"}
                  quiet={faded && isLarry}
                  toLarry={!isLarry && !!m.toLarry}
                  excused={!isLarry && !!m.excused}
                  showName={!continued}
                  footer={move && <MoveTag move={move} />}
                >
                  {m.text}
                </ChatBubble>
              );
            })}

            {together && !away && !messages.some((m) => m.from === "larry") && !larryBusy && (
              <div className="rounded-mini border-2 border-dashed border-ink-soft p-4">
                <p className="text-ink">
                  {APP_NAME} has read all {members.length} cards. It can open the chat with something you share, and make
                  sure everyone gets a turn.
                </p>
                <button type="button" onClick={() => send(START_QUESTION, true)} className={cn(buttonStyles.primary, "mt-3 min-h-12")}>
                  <LarryAvatar size="sm" decorative className="ring-paper" />
                  Ask {APP_NAME} to start us off
                </button>
                <p className="mt-2 text-label text-ink-soft">Or just say hi to the group below.</p>
              </div>
            )}

            {/* Shown on this phone only, after crisis words: the helplines, one tap away. */}
            {helpAt.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-ink bg-paper p-3">
                <LifeBuoy className="size-5" aria-hidden />
                <p className="flex-1 font-bold">Help is one tap away.</p>
                <button type="button" onClick={() => helpRef.current?.open()} className={cn(buttonStyles.primary, "min-h-12")}>
                  See helplines
                </button>
              </div>
            )}

            {learning.note && <LearnedNote note={learning.note} onUndo={learning.undo} onDismiss={learning.dismiss} />}
            {larryBusy && !away && <TypingRow text={`${APP_NAME} is thinking about the whole group…`} />}
            {faded && <FadeChip onWake={wakeLarry} />}
            <div ref={bottomRef} className="scroll-mb-2" />
          </section>
          {sendError && (
            <p role="alert" className="mt-3 rounded-mini bg-paper p-3 font-bold text-danger ring-2 ring-danger">
              {sendError}
            </p>
          )}
          {offline && (
            <p role="status" className="mt-3 flex items-center gap-2 rounded-mini bg-paper p-3 font-bold text-ink ring-2 ring-line">
              <WifiOff className="size-5 shrink-0" aria-hidden /> Reconnecting… New messages will show when you are back online.
            </p>
          )}
          <p role="status" className="sr-only">
            {larryBusy && !away ? `${APP_NAME} is thinking` : announce}
          </p>
        </div>
      </main>

      <div
        ref={composerRef}
        role="region"
        aria-label="Message box"
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-border-subtle bg-table px-3 pb-3 pt-2 sm:pt-3 lg:left-auto lg:right-[max(0px,calc((100vw-72rem)/2))] lg:w-[calc(28rem+2.5rem)] lg:border-t-0 lg:pl-0 lg:pr-5 max-lg:[@media(max-height:640px)]:static [@media(max-height:500px)]:static"
      >
        <div className="mx-auto max-w-3xl">
          {together && me ? (
            <PromptInputBox
              speakers={[{ name: me.name, color: me.color }]}
              activeSpeaker={0}
              onSpeakerChange={() => {}}
              onSend={send}
              replies={REPLIES}
              replyTo="everyone"
              repliesLabel={askedMe ? `${APP_NAME} asked you. Tap to answer.` : "Your replies"}
              repliesHighlight={!!askedMe}
              larryQuestions={LARRY_QUESTIONS}
              mode={mode}
              onModeChange={setMode}
              larryBusy={larryBusy}
              away={away}
              onAwayChange={meet ? undefined : changeAway}
              justUsNote={JUST_US_NOTE}
              placeholder={away || mode === "us" ? "Write to the group…" : `Write to ${APP_NAME} and the group…`}
            />
          ) : (
            <p className="rounded-panel border-2 border-dashed border-ink-soft bg-paper p-4 text-center font-bold text-ink">
              The chat opens when someone else joins.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Open to meet: Block or report the other person, always in the header (one tap away), even after
 * they left the chat. A clear ringed shield, like the one under "Who's here".
 */
function HeaderSafety({ creds, people }: { creds: RoomCredentials; people: { id: string; name: string }[] }) {
  return people.map((o) => <BlockReport key={o.id} target={{ room: creds, targetMemberId: o.id }} who={o.name} />);
}

/** While waiting: what happens in a room, and what Larry does in it. */
function HowItWorks() {
  const steps = [
    "Everyone joins with their taste card, on their own phone.",
    `${APP_NAME} finds what you might all love, and says why.`,
    `${APP_NAME} opens the chat and makes sure everyone gets a turn. Then it steps back.`,
    "You leave with one real thing to do together.",
  ];
  return (
    <section aria-labelledby="how-title" className="mt-4 rounded-panel border-2 border-dashed border-ink-soft p-4 lg:mt-0">
      <h2 id="how-title" className="font-display text-title-sm font-black leading-tight">
        How a room works
      </h2>
      <ol className="mt-3 flex flex-col gap-3">
        {steps.map((text, i) => (
          <li key={text} className="flex items-start gap-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-ink font-display text-label font-black text-paper">
              {i + 1}
            </span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
