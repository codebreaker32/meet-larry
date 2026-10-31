"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, Loader2, Lock, MapPin, MapPinCheck, Plus, Undo2 } from "lucide-react";
import Link from "next/link";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { VIBE_ICON } from "@/components/place-card";
import { STEP_KIND, StepKindPill } from "@/components/step-kind";
import { CheckInSheet, type CheckInStep } from "@/components/checkin/check-in-sheet";
import { GloryCount } from "@/components/glory-count";
import { PlacesCollection } from "@/components/places-collection";
import { SiteHeader } from "@/components/site-header";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { forgetPlaces, settleStaleVisit, useCounters, useOpenVisit } from "@/lib/checkins";
import type { PlaceVibe } from "@/lib/contracts";
import { useGlory } from "@/lib/glory";
import { LOCATION_OFF_LINE, LOCATION_SETTINGS_HREF, useApproxLocation } from "@/lib/location";
import { applyPersonaUpdate, describePersonaUpdate, isEmptyUpdate, loadPersona, personaToProfile, savePersona, usePersona } from "@/lib/persona";
import { addSteps, isSameOpenStep, saveSteps, useProfile, useSteps } from "@/lib/storage";
import { decodeStepLink, type StepLink } from "@/lib/step-link";
import {
  CHECK_IN_REASONS,
  currentRung,
  fetchNextRung,
  isPlaceStep,
  ladderPlaces,
  ladderStep,
  nextOnLadder,
  nextRung,
  nextRungFallback,
  VIBE_WORD,
  VIBES,
  type LadderPlace,
  type PlanDraft,
  type PlanStep,
} from "@/lib/suggest-steps";
import type { CheckInReason, NextRungResult } from "@/lib/contracts";
import type { Feeling, FirstStep, Place } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DURATION, EASE_DEAL } from "@/lib/tokens";
import { recentPlacesField, signalsField } from "@/lib/mood";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Ask about a saved step once it is this old, and again this long after "Not yet". */
const CHECK_IN_AFTER = 20 * 60 * 60 * 1000;

// The private check-in: "I did it", how it felt and (for a real place) one tap on why. It stays on
// this phone. Larry picks the next rung from real places with that answer (the fixed table, Easy
// up / OK stay / Hard back, is only the offline fallback), and learns from it for the persona.
const FEELINGS: { id: Feeling; label: string; heading: string; reply: string }[] = [
  { id: "good", label: "Easy", heading: "Easy. Great.", reply: "Small steps add up. You did a real thing." },
  { id: "okay", label: "OK", heading: "OK still counts.", reply: "You did a real thing. That's what matters." },
  {
    id: "hard",
    label: "Hard",
    heading: "That took courage.",
    reply: "Hard ones count the most, and you did it anyway. A calmer step next makes it easier.",
  },
];

const RUNG_TEXT: Record<PlaceVibe, string> = {
  calm: "Quiet places. Sit a while, no need to talk.",
  cosy: "Easy places to hang out. A little more going on.",
  lively: "Busier places. More people, more to join in with.",
};

type Stage = "feeling" | "later" | "next" | Feeling;
type DraftStep = Omit<FirstStep, "id" | "createdAt" | "done">;
type Offer = { draft?: DraftStep; why: string; askVibe?: PlaceVibe; top?: boolean; fromLarry?: boolean };

/** Every real place the ladder knows, for Larry to choose from. */
const candidatesOf = (pool: Record<PlaceVibe, LadderPlace[]>) =>
  VIBES.flatMap((v) => pool[v]).slice(0, 10).map((p) => ({ id: p.id, name: p.name, vibe: p.vibe, ...(p.tags?.length ? { tags: p.tags } : {}), ...(p.about ? { about: p.about } : {}) }));

/** Larry's (or the table's) next-rung answer as an offer to save. */
function offerFromRung(step: PlanStep, r: NextRungResult, pool: Record<PlaceVibe, LadderPlace[]>, top: boolean): Offer {
  const place = VIBES.flatMap((v) => pool[v]).find((p) => p.id === r.placeId);
  if (top) return { why: "You went from calm all the way to lively. You don't need me for this one any more.", top: true };
  return place ? { draft: ladderStep(place, step.withPerson), why: r.why, fromLarry: !r.fallback } : { why: r.why, askVibe: r.vibe, fromLarry: !r.fallback };
}

/**
 * After a finished step: for a real place, the next rung of the Quiet-to-Lively Ladder (a real
 * place, or Larry is asked for one); for other "go" steps the older same-place ladder.
 */
function followUp(step: FirstStep, feeling: Feeling | null, pool: Record<PlaceVibe, LadderPlace[]>): Offer | null {
  if (step.kind !== "go") return null;
  if (isPlaceStep(step)) {
    // Hard keeps the rung and shortens the visit: same kind of place, twenty minutes is plenty.
    const n = nextOnLadder(step, feeling === "hard" ? "okay" : (feeling ?? "okay"), pool);
    if (feeling === "hard") {
      const why = "No rush. Same kind of place next time, just a shorter visit. Twenty minutes is plenty.";
      return n.place ? { draft: ladderStep(n.place, step.withPerson), why } : { why, askVibe: n.vibe };
    }
    if (n.top) return { why: "You went from calm all the way to lively. You don't need me for this one any more.", top: true };
    const word = VIBE_WORD[n.vibe].toLowerCase();
    const why =
      n.move === "up"
        ? `That felt easy. Next time: somewhere ${word}.`
        : n.move === "back"
          ? `No rush. Something ${word} next time.`
          : n.place?.id === step.placeId
            ? "Same kind of place again. Going back is how a place becomes yours."
            : `Same again: another ${word} place.`;
    return n.place ? { draft: ladderStep(n.place, step.withPerson), why } : { why, askVibe: n.vibe };
  }
  if (feeling === "hard") {
    return {
      draft: { kind: step.kind, text: step.text, withPerson: step.withPerson, rung: step.rung ?? 0 },
      why: "Try the same step again. No need to go bigger yet.",
    };
  }
  const next = nextRung(step);
  return next ? { draft: next, why: "Ready for a slightly bigger step?" } : null;
}

/** Calendar days, so "yesterday" means the day before today. */
function savedAgo(createdAt: number, now: number) {
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (24 * 60 * 60 * 1000);
  };
  const days = day(now) - day(createdAt);
  return days === 0 ? "You saved this earlier today." : days === 1 ? "You saved this yesterday." : `You saved this ${days} days ago.`;
}

export default function StepsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <Suspense fallback={<div className="flex-1" />}>
        <Steps />
      </Suspense>
    </div>
  );
}

function Steps() {
  const steps = useSteps();
  const profile = useProfile();
  const router = useRouter();
  const params = useSearchParams();
  const addParam = params.get("add");
  const incoming = React.useMemo(() => (addParam ? decodeStepLink(addParam) : null), [addParam]);
  const reduce = useReducedMotion();
  // Read once: the check-in shouldn't appear or vanish while someone is looking at it.
  const [now] = React.useState(() => Date.now());
  const [checkIn, setCheckIn] = React.useState<{ id: string; stage: Stage } | null>(null);
  const [checkedIn, setCheckedIn] = React.useState(false);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const persona = usePersona();
  const counters = useCounters();
  const openVisit = useOpenVisit();
  const glory = useGlory();
  // The check-in sheet: where to arrive, and the plan step behind it (its opener, plan B and guess).
  const [sheet, setSheet] = React.useState<{ place: { id: string; name: string }; step?: PlanStep } | null>(null);
  const [sheetHidden, setSheetHidden] = React.useState(false);
  // A visit with no Leave for 12 hours becomes "Visited" (D16), and its token and time are deleted.
  React.useEffect(() => {
    settleStaleVisit();
  }, []);
  // Real places Qloo found near this person for the ladder (this visit to the page only).
  const [found, setFound] = React.useState<Place[]>([]);

  const update = (next: FirstStep[]) => saveSteps(next);
  const undo = (id: string) =>
    update(
      (steps ?? []).map((s) => (s.id === id ? { ...s, done: false, doneAt: undefined, feeling: undefined } : s)),
    );

  const patch = (id: string, change: Partial<FirstStep>) =>
    update((steps ?? []).map((s) => (s.id === id ? { ...s, ...change } : s)));

  const acceptIncoming = (s: StepLink) => {
    addSteps([s]);
    router.replace("/steps");
  };

  // One "I did it" for every path: mark it done, then the same check-in asks how it went.
  const did = (id: string) => {
    patch(id, { done: true, doneAt: Date.now() });
    setCheckIn({ id, stage: "feeling" });
  };

  const imHere = (place: { id: string; name: string }, step?: PlanStep) => {
    setSheet({ place, step });
    setSheetHidden(false);
  };

  if (steps === undefined) return <div className="flex-1" />;
  const pool = ladderPlaces(steps, found);
  const rung = currentRung(steps);
  const picks = persona ? personaToProfile(persona, 30).items : (profile?.items ?? []);
  const allDone = steps.filter((s) => s.done);
  // The oldest open step that is due a gentle check-in. One at a time, never a list of nags.
  const due = steps
    .filter((s) => !s.done)
    .reverse()
    .find((s) => now - s.createdAt > CHECK_IN_AFTER && (!s.checkedAt || now - s.checkedAt > CHECK_IN_AFTER));
  const showCheckIn = !incoming && (checkIn || (due && !checkedIn));
  const activeId = showCheckIn ? (checkIn?.id ?? due?.id) : undefined;
  const active = steps.find((s) => s.id === activeId);
  // The step in the check-in card isn't listed again below it.
  const todo = steps.filter((s) => !s.done && s.id !== activeId);
  const done = allDone.filter((s) => s.id !== activeId);
  // A shared step that is already on the list: say so instead of offering to save it again.
  const incomingSaved = !!incoming && steps.some((s) => isSameOpenStep(s, incoming));
  // The sheet follows an open visit (arrived, not left yet) even after a reload, unless hidden for now.
  const visitStep = openVisit?.stepId ? (steps.find((s) => s.id === openVisit.stepId) as PlanStep | undefined) : undefined;
  const sheetStep = sheet?.step ?? visitStep;
  const sheetPlace = openVisit ? { id: openVisit.placeId, name: openVisit.placeName } : sheet?.place;
  const showSheet = !incoming && !!sheetPlace && (!!sheet || (!!openVisit && !sheetHidden));
  const closeSheet = () => {
    setSheet(null);
    setSheetHidden(true);
    titleRef.current?.focus();
  };

  return (
    <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16 sm:px-8">
      <h1 ref={titleRef} tabIndex={-1} className="font-display outline-none text-title-page font-black leading-title">First Steps</h1>
      <p className="mt-3 max-w-measure text-lead text-ink-soft">Small real things to do, with real people. Tick each one off when you&apos;ve done it.</p>
      {!!glory && <GloryCount value={glory} size="chip" className="mt-4" />}

      {incoming && (
        <section
          aria-labelledby="incoming-title"
          className="mt-8 rounded-card border-(length:--border-frame) border-ink bg-paper p-5 shadow-panel"
        >
          <StepKindPill kind={incoming.kind} className="mb-3" />
          <h2 id="incoming-title" className="font-display text-intro font-black leading-tight">
            {incomingSaved ? "You already saved this one" : "Save this First Step?"}
          </h2>
          <p className="mt-2 text-lead font-bold">{incoming.text}</p>
          {incoming.withPerson && <p className="text-ink-soft">With {incoming.withPerson}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            {incomingSaved ? (
              <button type="button" onClick={() => router.replace("/steps")} className={cn(buttonStyles.primary, "min-h-12")}>
                <Check className="size-5" aria-hidden /> OK
              </button>
            ) : (
              <>
                <button type="button" onClick={() => acceptIncoming(incoming)} className={cn(buttonStyles.primary, "min-h-12")}>
                  Save
                </button>
                <button type="button" onClick={() => router.replace("/steps")} className={cn(buttonStyles.secondary, "min-h-12")}>
                  No thanks
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {showSheet && sheetPlace && (
        <CheckInSheet
          key={sheetPlace.id}
          onSettled={() => setSheet({ place: sheetPlace, step: sheetStep })}
          place={sheetPlace}
          visit={openVisit ?? null}
          step={sheetStep ? checkInStep(sheetStep) : undefined}
          onSaveRepeat={(d) => {
            const draft: PlanDraft = { kind: "go", text: `Go back to ${d.placeName}, ${d.when}.`, placeId: d.placeId, placeName: d.placeName, when: d.when, rung: d.vibe ? VIBES.indexOf(d.vibe) : 0, ...(d.vibe ? { vibe: d.vibe } : {}) };
            addSteps([draft]);
          }}
          onNext={
            sheetStep
              ? (feeling) => {
                  // The counted visit finishes its plan step; the ladder check-in asks why, then Larry picks the next place.
                  patch(sheetStep.id, { done: true, doneAt: Date.now(), feeling });
                  setSheet(null);
                  setSheetHidden(true);
                  setCheckIn({ id: sheetStep.id, stage: feeling });
                }
              : undefined
          }
          onClose={closeSheet}
        />
      )}

      {showCheckIn && active && (
        <CheckIn
          key={active.id}
          step={active}
          pool={pool}
          stage={checkIn?.id === active.id ? checkIn.stage : null}
          ago={checkIn ? null : savedAgo(active.createdAt, now)}
          onDid={() => did(active.id)}
          onNotYet={() => {
            patch(active.id, { checkedAt: Date.now() });
            setCheckIn({ id: active.id, stage: "later" });
          }}
          onFeeling={(feeling) => {
            patch(active.id, { feeling });
            setCheckIn({ id: active.id, stage: feeling });
          }}
          onSkipFeeling={() => setCheckIn({ id: active.id, stage: "next" })}
          onSaveNext={(draft) => addSteps([draft])}
          onClose={() => {
            setCheckIn(null);
            setCheckedIn(true);
            // The card and its Close button are gone; land at the top of the page, not on <body>.
            titleRef.current?.focus();
          }}
        />
      )}

      {steps.length === 0 && !incoming && (
        <div className="mt-8 rounded-card bg-paper p-5 ring-2 ring-line">
          <p className="font-bold">Nothing here yet.</p>
          <p className="mt-1 text-ink-soft">Swap cards with someone, or pick a pal to warm up first. Save a plan at the end.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <LinkButton href="/card" className="min-h-12">
              Show my card
            </LinkButton>
            <LinkButton href="/practice" variant="secondary" className="min-h-12">
              Pick a pal
            </LinkButton>
          </div>
        </div>
      )}

      {todo.length > 0 && (
        <ul className="mt-8 flex flex-col gap-3">
          {todo.map((s) => (
            <StepRow
              key={s.id}
              step={s}
              onToggle={() => did(s.id)}
              onHere={isPlaceStep(s) && !openVisit ? () => imHere({ id: s.placeId, name: s.placeName }, s) : undefined}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <h2 className="mt-10 font-display text-title-sm font-black">Done</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {done.map((s) => (
              <StepRow key={s.id} step={s} onToggle={() => undo(s.id)} reduce={!!reduce} />
            ))}
          </ul>
        </>
      )}

      {/* The Quiet-to-Lively Ladder: real places, calm to lively. Larry picks the place for a rung
          (it looks them up with Qloo and says why); a private check-in after each step moves you. */}
      <Ladder
        rung={rung}
        pool={pool}
        steps={steps}
        hasCard={!!profile || !!persona}
        picks={picks}
        onFound={setFound}
      />

      {counters && counters.length > 0 && (
        <PlacesCollection counters={counters} onCheckIn={openVisit ? undefined : (p) => imHere(p)} onForget={forgetPlaces} />
      )}
    </main>
  );
}

function CheckIn({
  step,
  pool,
  stage,
  ago,
  onDid,
  onNotYet,
  onFeeling,
  onSkipFeeling,
  onSaveNext,
  onClose,
}: {
  step: FirstStep;
  pool: Record<PlaceVibe, LadderPlace[]>;
  stage: Stage | null;
  ago: string | null;
  onDid: () => void;
  onNotYet: () => void;
  onFeeling: (feeling: Feeling) => void;
  onSkipFeeling: () => void;
  onSaveNext: (draft: DraftStep) => void;
  onClose: () => void;
}) {
  const heading = React.useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = React.useState(false);
  // Each answer swaps the buttons out, so keep focus in the card instead of losing it to the page.
  React.useEffect(() => {
    if (stage) heading.current?.focus();
  }, [stage]);
  const feeling = FEELINGS.find((f) => f.id === stage);
  // The places as they were when the card opened: saving the next step adds to them, and the offer must not jump.
  const [poolAtStart] = React.useState(pool);
  // A real place: one more tap on why, then Larry picks the next rung (the table only offline).
  const placeStep = isPlaceStep(step) ? step : null;
  const [reason, setReason] = React.useState<CheckInReason | "skip" | null>(null);
  const [larry, setLarry] = React.useState<{ offer: Offer; learned: string[] } | "asking" | null>(null);
  const askReason = !!placeStep && !!feeling && reason === null;

  const chooseReason = (r: CheckInReason | "skip") => {
    if (!placeStep || !feeling) return;
    setReason(r);
    setLarry("asking");
    const persona = loadPersona();
    const input = {
      step: { text: placeStep.text, placeId: placeStep.placeId, placeName: placeStep.placeName, ...(placeStep.vibe ? { vibe: placeStep.vibe } : {}) },
      feeling: feeling.id,
      ...(r !== "skip" ? { reason: r } : {}),
      candidates: candidatesOf(poolAtStart),
      ...(persona ? { persona: { picks: persona.likes.slice(0, 10).map((l) => l.name), ...(persona.placeVibe ? { placeVibe: persona.placeVibe } : {}) } } : {}),
    };
    void fetchNextRung({ kind: "next_rung", ...input }, apiFetch).then((res) => {
      const answer = res ?? nextRungFallback(input);
      // What Larry learned goes into the persona on this phone (private, like the check-in).
      let learned: string[] = [];
      const now = loadPersona();
      if (now && answer.learned && !isEmptyUpdate(answer.learned)) {
        savePersona(applyPersonaUpdate(now, answer.learned));
        learned = describePersonaUpdate(answer.learned);
      }
      const top = placeStep.vibe === "lively" && feeling.id === "good" && r !== "too_loud";
      setLarry({ offer: offerFromRung(placeStep, answer, poolAtStart, top), learned });
      requestAnimationFrame(() => heading.current?.focus());
    });
  };

  const offer = placeStep
    ? larry && larry !== "asking"
      ? larry.offer
      : stage === "next"
        ? followUp(step, null, poolAtStart)
        : null
    : stage === "next" || feeling
      ? followUp(step, feeling?.id ?? null, poolAtStart)
      : null;
  const topOfLadder =
    !!offer?.top ||
    (!isPlaceStep(step) && (stage === "next" || (feeling && feeling.id !== "hard")) && step.kind === "go" && !offer);
  const draft = offer?.draft;

  const title =
    stage === null
      ? "Did you do this?"
      : stage === "feeling"
        ? "Nice one. How was it?"
        : stage === "later"
          ? "That's fine."
          : stage === "next"
            ? "Done. Nice one."
            : feeling!.heading;

  return (
    <section aria-labelledby="check-in-title" className="mt-8 rounded-card border-(length:--border-frame) border-ink bg-paper p-5 shadow-panel">
      <h2 id="check-in-title" ref={heading} tabIndex={-1} className="font-display text-intro font-black leading-tight outline-none">
        {title}
      </h2>
      <p className="mt-2 text-lead font-bold">{step.text}</p>
      {stage === null && ago && <p className="text-ink-soft">{ago}</p>}
      {stage === "later" && <p className="mt-1 text-ink-soft">It stays on your list. Do it when you&apos;re ready.</p>}
      {feeling && <p className="mt-1 text-ink">{feeling.reply}</p>}
      {askReason && (
        <div className="mt-4">
          <h3 id="reason-title" className="font-bold">
            What made it {feeling!.label.toLowerCase()}? Tap one, and {APP_NAME} picks your next place.
          </h3>
          <div role="group" aria-labelledby="reason-title" className="mt-2 flex flex-wrap gap-2">
            {CHECK_IN_REASONS.map((r) => (
              <button key={r.id} type="button" onClick={() => chooseReason(r.id)} className={cn(buttonStyles.secondary, "min-h-12")}>
                {r.label}
              </button>
            ))}
            <button type="button" onClick={() => chooseReason("skip")} className={buttonStyles.quiet}>
              Skip
            </button>
          </div>
        </div>
      )}
      {larry === "asking" && (
        <p role="status" className="mt-4 flex items-center gap-2 font-bold">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is picking your next place…
        </p>
      )}
      {larry && larry !== "asking" && larry.learned.length > 0 && (
        <div className="mt-4 rounded-mini bg-table p-3">
          <p className="font-bold">{APP_NAME} learned:</p>
          <ul className="mt-1 list-disc pl-5">
            {larry.learned.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {topOfLadder && (
        <p className="mt-1 text-ink">
          {offer?.top
            ? offer.why
            : "You went, stayed, brought someone and invited someone. You don't need me for this one any more."}
        </p>
      )}
      {(stage === "feeling" || feeling) && isPlaceStep(step) && (
        <p className="mt-2 flex items-center gap-1.5 text-label text-ink-soft">
          <Lock className="size-4 shrink-0" aria-hidden /> Only you see this.
        </p>
      )}

      {offer && !offer.top && draft && (
        <div className="mt-4 rounded-mini border-(length:--border-frame) border-cat-film bg-table p-3">
          <p className="text-ink">
            {offer.fromLarry && <span className="font-bold">{APP_NAME}: </span>}
            {offer.why}
          </p>
          <p className="mt-1 font-bold">{draft.text}</p>
          {saved ? (
            <p role="status" className="mt-2 flex min-h-12 items-center gap-2 font-bold text-ink">
              <Check className="size-5" aria-hidden /> Saved to your First Steps.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                onSaveNext(draft);
                setSaved(true);
              }}
              className={cn(buttonStyles.primary, "mt-3 min-h-12")}
            >
              <Plus className="size-5" aria-hidden /> Save this step
            </button>
          )}
        </div>
      )}
      {offer?.askVibe && (
        <div className="mt-4 rounded-mini border-2 border-dashed border-border-subtle bg-table p-3">
          <p className="text-ink">{offer.why}</p>
          <LinkButton href={`/larry?ask=place&vibe=${offer.askVibe}`} variant="secondary" className="mt-3 min-h-12">
            <MapPin className="size-5" aria-hidden /> Ask {APP_NAME} for a {VIBE_WORD[offer.askVibe].toLowerCase()} place
          </LinkButton>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {stage === null && (
          <>
            <button type="button" onClick={onDid} className={cn(buttonStyles.primary, "min-h-12")}>
              Yes, I did it
            </button>
            <button type="button" onClick={onNotYet} className={cn(buttonStyles.secondary, "min-h-12")}>
              Not yet
            </button>
          </>
        )}
        {stage === "feeling" &&
          FEELINGS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFeeling(f.id)}
              className={cn(buttonStyles.secondary, "min-h-12 min-w-24")}
            >
              {f.label}
            </button>
          ))}
        {stage === "feeling" && (
          <button type="button" onClick={onSkipFeeling} className={cn(buttonStyles.quiet)}>
            Skip
          </button>
        )}
        {stage !== null && stage !== "feeling" && !askReason && larry !== "asking" && (
          <button type="button" onClick={onClose} className={cn(buttonStyles.secondary, "min-h-12")}>
            {draft && !saved ? "Not now" : "Close"}
          </button>
        )}
      </div>
    </section>
  );
}

function StepRow({
  step,
  onToggle,
  onHere,
  reduce = true,
}: {
  step: FirstStep;
  onToggle: () => void;
  /** "I'm here": a check-in at this step's planned place. */
  onHere?: () => void;
  reduce?: boolean;
}) {
  const { label } = STEP_KIND[step.kind];
  const withLine = step.withPerson && !step.text.includes(step.withPerson) ? `With ${step.withPerson}` : null;
  const plan = step as PlanStep;
  return (
    // A saved, open step wears the coral ring (the one First Step marker); a done one goes quiet.
    // Its kind is a neutral pill, never a domain colour.
    <li className={cn("flex items-center gap-3 rounded-mini border-(length:--border-frame) p-3", step.done ? "border-line bg-table" : "border-cat-film bg-paper")}>
      {/* The label is already read out with the step text. */}
      <StepKindPill kind={step.kind} decorative variant="compact" />
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug">
          <span className="sr-only">{label}: </span>
          {step.text}
        </p>
        {withLine && <p className="text-label text-ink-soft">{withLine}</p>}
        {!step.done && plan.opener && (
          <p className="mt-1 text-label text-ink">
            <span className="font-bold">Your line: </span>
            {plan.opener}
          </p>
        )}
        {!step.done && plan.planB && <p className="mt-0.5 text-label text-ink-soft">{plan.planB}</p>}
        {!step.done && onHere && (
          <button
            type="button"
            onClick={onHere}
            aria-label={`I'm here: ${plan.placeName ?? step.text}`}
            className={cn(buttonStyles.secondary, "mt-2 min-h-12 px-4 text-label")}
          >
            <MapPinCheck className="size-4" aria-hidden /> I&apos;m here
          </button>
        )}
        {step.done && (
          <motion.span
            initial={reduce ? false : { scale: 1.6, opacity: 0, rotate: -16 }}
            animate={{ scale: 1, opacity: 1, rotate: -4 }}
            transition={{ duration: DURATION.base, ease: EASE_DEAL }}
            className="mt-1.5 inline-block rounded-tile border-(length:--border-frame) border-cat-games-ink px-2 py-0.5 font-display text-caption font-black uppercase text-cat-games-ink"
          >
            Done {dateFmt.format(step.doneAt ?? step.createdAt)}
          </motion.span>
        )}
      </div>
      {step.done ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Undo: mark as not done: ${step.text}`}
          className="press press-hard flex min-h-12 shrink-0 items-center gap-1.5 rounded-full border-2 border-ink bg-paper px-4 text-label font-bold text-ink hover:bg-table"
        >
          <Undo2 className="size-4" aria-hidden /> Undo
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`I did it: ${step.text}`}
          className={cn(buttonStyles.secondary, "min-h-12 shrink-0 px-4 text-label")}
        >
          I did it
        </button>
      )}
    </li>
  );
}

/**
 * The Quiet-to-Lively Ladder: three rungs of real places, calm to lively, with this person's rung
 * marked. Places come from their saved plans and from Qloo near them; an empty rung asks Larry.
 */
function Ladder({
  rung,
  pool,
  steps,
  hasCard,
  picks,
  onFound,
}: {
  rung: number;
  pool: Record<PlaceVibe, LadderPlace[]>;
  steps: FirstStep[];
  hasCard: boolean;
  picks: { id: string; name: string }[];
  onFound: (places: Place[]) => void;
}) {
  const [state, setState] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const planned = (p: LadderPlace) => steps.some((s) => !s.done && isPlaceStep(s) && s.placeId === p.id);
  // D24: location was asked once, at onboarding. Read the stored coarse point (about 1 km); never ask here.
  const { location } = useApproxLocation();
  const lat = location?.lat;
  const lon = location?.lon;
  const pickIds = picks.slice(0, 30).map((i) => i.id).join(",");
  const picksRef = React.useRef(picks);
  React.useEffect(() => {
    picksRef.current = picks;
  });

  // Real places near the stored point, matched to this person's taste by Qloo. Once per point.
  React.useEffect(() => {
    if (!hasCard || lat === undefined || lon === undefined || !pickIds) return;
    let live = true;
    const run = async () => {
      setState("loading");
      try {
        const res = await apiFetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: picksRef.current.slice(0, 30).map((i) => ({ id: i.id, name: i.name })), lat, lon, ...signalsField(), ...recentPlacesField() }),
        });
        const body = (await res.json().catch(() => ({}))) as { places?: Place[] };
        if (!live) return;
        if (!res.ok) throw new Error("places");
        onFound(body.places ?? []);
        setState("done");
      } catch {
        if (live) setState("error");
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [hasCard, lat, lon, pickIds, onFound]);

  return (
    <section className="mt-12 border-t-2 border-ink pt-8" aria-labelledby="ladder-title">
      <h2 id="ladder-title" className="font-display text-title-sm font-black">
        Quiet to lively
      </h2>
      <p className="mt-1 max-w-measure text-ink-soft">
        Real places near you, from calm to lively. When a place feels easy, try a busier one. When it feels hard, stay or go quieter.
      </p>
      <ol className="mt-4 flex flex-col gap-3">
        {VIBES.map((vibe, i) => {
          const Icon = VIBE_ICON[vibe];
          const places = pool[vibe].slice(0, 2);
          const mine = i === rung;
          return (
            <li
              key={vibe}
              aria-current={mine ? "step" : undefined}
              className={cn(
                // The whole rung is tappable (a stretched link on its title): Larry finds a place with this vibe.
                // The Plan buttons inside sit above the link.
                "relative rounded-mini border-(length:--border-frame) bg-paper p-3 transition-colors duration-(--dur-quick) has-[a[data-rung]:hover]:bg-table has-[a[data-rung]:focus-visible]:outline-3 has-[a[data-rung]:focus-visible]:outline-offset-2 has-[a[data-rung]:focus-visible]:outline-focus-ring",
                mine ? "border-ink shadow-mini" : "border-border-control",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink">
                  <Icon className="size-5" />
                </span>
                <h3 className="font-display text-body font-black">
                  {hasCard ? (
                    <Link
                      href={`/larry?ask=place&vibe=${vibe}`}
                      data-rung={vibe}
                      aria-label={`${VIBE_WORD[vibe]}: ask ${APP_NAME} for a ${VIBE_WORD[vibe].toLowerCase()} place`}
                      className="outline-none after:absolute after:inset-0 after:rounded-mini after:content-['']"
                    >
                      {VIBE_WORD[vibe]}
                    </Link>
                  ) : (
                    VIBE_WORD[vibe]
                  )}
                </h3>
                {hasCard && !mine && <ChevronRight aria-hidden className="ml-auto size-5 text-ink-soft" />}
                {mine && <span className="ml-auto rounded-full bg-ink px-3 py-1 text-caption font-bold text-paper">You are here</span>}
              </div>
              <p className="mt-1 text-label text-ink-soft">{RUNG_TEXT[vibe]}</p>
              {places.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-2">
                  {places.map((p) => {
                    const isPlanned = planned(p);
                    return (
                      <li key={p.id} className="relative z-10 flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 font-bold">{p.name}</span>
                        <button
                          type="button"
                          onClick={() => !isPlanned && addSteps([ladderStep(p)])}
                          aria-pressed={isPlanned}
                          aria-label={`${isPlanned ? "Planned" : "Plan this"}: ${p.name}`}
                          className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}
                        >
                          {isPlanned ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                          {isPlanned ? "Planned" : "Plan this"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : hasCard ? (
                <span aria-hidden className="mt-2 inline-flex min-h-12 items-center gap-2 font-bold underline decoration-2 underline-offset-4">
                  <MapPin className="size-4" aria-hidden /> Ask {APP_NAME} for a {VIBE_WORD[vibe].toLowerCase()} place
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!hasCard ? (
        <LinkButton href="/create" variant="secondary" className="mt-4 min-h-12">
          Make a taste card first
        </LinkButton>
      ) : !location ? (
        <p className="mt-4 text-label text-ink-soft">
          <Link href={LOCATION_SETTINGS_HREF} className="font-bold text-ink underline decoration-2 underline-offset-4">
            {LOCATION_OFF_LINE}
          </Link>
        </p>
      ) : (
        <p role="status" className={cn("mt-4 flex items-center gap-2 text-label", state === "error" ? "font-bold text-ink" : "text-ink-soft")}>
          {state === "loading" && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />}
          {state === "error"
            ? "Hmm, places didn't load this time. Tap a rung and Larry will find one."
            : state === "loading"
              ? `${APP_NAME} is looking for places near you that fit your taste…`
              : `${APP_NAME} (an AI) found these places near you, matched to your taste card.`}
        </p>
      )}
    </section>
  );
}

/** The parts of a plan step the check-in sheet shows while there. */
function checkInStep(s: PlanStep): CheckInStep {
  return {
    id: s.id,
    ...(s.opener ? { opener: s.opener } : {}),
    ...(s.planB ? { planB: s.planB } : {}),
    ...(s.guess ? { guess: s.guess } : {}),
    ...(s.vibe ? { vibe: s.vibe } : {}),
  };
}
