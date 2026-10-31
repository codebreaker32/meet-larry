"use client";

import * as React from "react";
import { success } from "@/lib/haptics";
import { BadgeCheck, CalendarPlus, Check, DoorOpen, Hand, Loader2, Lock, MapPinCheck, RotateCw } from "lucide-react";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { LarryAvatar } from "@/components/larry-avatar";
import { AppCard, showAppCardAfterWin } from "@/components/app-card";
import { GloryMoment } from "@/components/glory-moment";
import { ShowThis } from "@/components/show-this";
import type { FaceValue } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import {
  applyLeave,
  arriveRefusalLine,
  countedLine,
  dwellDone,
  leaveReasonLine,
  nextStageLine,
  saveOpenVisit,
  settleStaleVisit,
  spotLine,
  type FoldResult,
  type OpenVisit,
} from "@/lib/checkins";
import { earnGlory, gloryForVisit, loadGlory } from "@/lib/glory";
import { LOCATION_SETTINGS_HREF } from "@/lib/location";
import { useMood } from "@/lib/mood";
import { canOpenToMeet, useAgeBucket } from "@/lib/age";
import { TITLES } from "@/lib/titles";
import type { LeaveReason } from "@/lib/types/checkin";
import type { WittyResult } from "@/lib/types/witty";
import { cn } from "@/lib/utils";
import { arrive, fetchPlayback, leave } from "./api";
import { feelingFromReality, GuessReveal, RealityPicker, type Glad } from "./guess-reality";

/** The plan step behind a visit: its line to say, plan B and guess show while there. */
export interface CheckInStep {
  id: string;
  opener?: string;
  planB?: string;
  guess?: FaceValue;
  vibe?: "calm" | "cosy" | "lively";
}

type Phase =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "refused"; line: string; permission?: boolean }
  | { kind: "here"; note?: string }
  | { kind: "leaving" }
  | { kind: "too-soon" }
  | {
      kind: "result";
      verified: boolean;
      reason?: LeaveReason;
      fold: FoldResult | null;
      glory: number;
      gain: number;
      when: string;
      saidHi: boolean;
    };

const PERMISSION_LINE = `${APP_NAME} needs your location for two taps, arriving and leaving. Nothing else. Turn it on in Your taste > Settings.`;
const ERROR_LINE = "Hmm, that didn't go through. Try again in a moment?";

/** "Sat 4pm" for a time, to offer the same slot next week. */
function slotOf(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
}

/**
 * Check-in v2 (spec 7): two taps at a real place, each with one fresh location fix checked on the
 * server and thrown away. Arrive ("I'm here"), a calm card while there (the app can close), Leave
 * ("I'm heading off") 20+ minutes later, then the result: Counted with the stage, Glory and Spot
 * weeks, "How did it go?" and Larry's line; or one warm reason it didn't count. No timer on screen.
 */
export function CheckInSheet({
  place,
  visit,
  step,
  onSaveRepeat,
  onNext,
  onSettled,
  onClose,
}: {
  /** Where to arrive. With an open visit, the sheet follows the visit instead. */
  place: { id: string; name: string };
  visit: OpenVisit | null;
  step?: CheckInStep;
  /** "Same place, same time next week?": saves a plan step. */
  onSaveRepeat: (draft: { placeId: string; placeName: string; when: string; vibe?: CheckInStep["vibe"] }) => void;
  /** Hand over to the ladder after a counted visit (Larry picks the next place). */
  onNext?: (feeling: "good" | "okay" | "hard") => void;
  /** Called once Leave is answered (the open visit is gone), so the page keeps the result on screen. */
  onSettled?: () => void;
  onClose: () => void;
}) {
  const mood = useMood() ?? undefined;
  // Open to meet is 18+: hidden for 13-17s and when the age range is unknown (D17).
  const adult = canOpenToMeet(useAgeBucket());
  const heading = React.useRef<HTMLHeadingElement>(null);
  const atPlace = visit ?? null;
  const name = atPlace?.placeName ?? place.name;
  const [phase, setPhase] = React.useState<Phase>(() => (atPlace ? { kind: "here" } : { kind: "idle" }));
  const [saidHi, setSaidHi] = React.useState(false);
  const [offerApp, setOfferApp] = React.useState(false);
  const [reality, setReality] = React.useState<FaceValue | null>(null);
  const [glad, setGlad] = React.useState<Glad | null>(null);
  const [line, setLine] = React.useState<WittyResult | "asking" | null>(null);
  const [repeatSaved, setRepeatSaved] = React.useState(false);
  // Read once per phase: the words shouldn't change while someone reads them.
  const [shownAt, setShownAt] = React.useState(() => Date.now());

  // Each new phase moves focus to the heading, so a screen reader hears the change.
  React.useEffect(() => {
    heading.current?.focus();
  }, [phase.kind]);
  const toPhase = (p: Phase) => {
    setShownAt(Date.now());
    setPhase(p);
  };

  const doArrive = async () => {
    if (phase.kind === "locating") return;
    setPhase({ kind: "locating" });
    const answer = await arrive(place.id);
    if (!answer.ok) {
      if (answer.reason === "no-permission") setPhase({ kind: "refused", line: PERMISSION_LINE, permission: true });
      else if (answer.reason === "error") setPhase({ kind: "refused", line: answer.line ?? ERROR_LINE });
      else
        setPhase({
          kind: "refused",
          line: arriveRefusalLine(answer.reason, place.name),
        });
      return;
    }
    saveOpenVisit({
      placeId: place.id,
      placeName: place.name,
      visitToken: answer.visitToken,
      dwellMs: answer.dwellMs,
      arrivedAt: Date.now(),
      ...(step ? { stepId: step.id } : {}),
    });
    setPhase({ kind: "here" });
  };

  const finish = (v: OpenVisit, verified: boolean, reason: LeaveReason | undefined, serverGain: number, hi: boolean) => {
    const when = slotOf(v.arrivedAt || Date.now());
    const fold = applyLeave(v, verified, reason);
    const { amount } = gloryForVisit(verified, hi);
    // Device Glory rises by what the visit earned (an account's server total rises by the same).
    const glory = verified ? earnGlory(Math.max(amount, serverGain)) : loadGlory();
    onSettled?.();
    // A counted visit is a real win: one success haptic (it covers the Glory moment too, so it never
    // buzzes twice), and the app card may follow (it never shows on a first visit).
    if (verified) {
      success();
      setOfferApp(showAppCardAfterWin("check-in"));
    }
    setPhase({
      kind: "result",
      verified,
      reason,
      fold,
      glory,
      gain: verified ? Math.max(amount, serverGain) : 0,
      when,
      saidHi: hi,
    });
  };

  const doLeave = async () => {
    if (!atPlace || phase.kind === "leaving") return;
    setPhase({ kind: "leaving" });
    const answer = await leave(atPlace.visitToken, saidHi);
    if (!answer.ok) {
      if (answer.reason === "expired") {
        settleStaleVisit(Date.now(), true);
        onSettled?.();
        setPhase({
          kind: "refused",
          line: answer.line ?? "This visit has ended. Tap I'm here to start a new one.",
        });
      } else {
        setPhase({
          kind: "here",
          note: answer.reason === "no-permission" ? PERMISSION_LINE : (answer.line ?? ERROR_LINE),
        });
      }
      return;
    }
    if (!answer.verified && answer.reason === "too-soon") return setPhase({ kind: "too-soon" });
    if (!answer.verified && answer.reason === "no-coords")
      return setPhase({
        kind: "here",
        note: leaveReasonLine("no-coords", name),
      });
    finish(atPlace, answer.verified, answer.reason, answer.gloryDelta, saidHi);
  };

  const askLarry = async (r: FaceValue | null, g: Glad | null) => {
    if (phase.kind !== "result" || !phase.fold) return;
    setLine("asking");
    const c = phase.fold.counter;
    const out = await fetchPlayback({
      placeName: c.placeName,
      visits: Math.max(1, c.visits),
      stage: c.stage,
      stageEarned: !!phase.fold.stageEarned,
      ...(step?.guess ? { guess: step.guess } : {}),
      ...(r ? { reality: r } : {}),
      ...(g ? { glad: g } : {}),
      ...(phase.saidHi ? { saidHi: true } : {}),
      ...(mood ? { mood } : {}),
    });
    setLine(
      out ?? {
        line: `You showed up at ${c.placeName}. That's the hard part done.`,
        plain: "Your visit counts.",
        source: "fallback",
      },
    );
  };

  const title =
    phase.kind === "idle"
      ? `Check in at ${name}`
      : phase.kind === "locating"
        ? "Finding you…"
        : phase.kind === "refused"
          ? "Not yet"
          : phase.kind === "here"
            ? `You're at ${name}. Enjoy it.`
            : phase.kind === "leaving"
              ? "Checking your visit…"
              : phase.kind === "too-soon"
                ? "That was quick!"
                : phase.verified
                  ? phase.fold
                    ? countedLine(phase.fold.counter)
                    : "Counted."
                  : phase.reason === "too-fast" || phase.reason === "already-today"
                    ? "This one didn't count"
                    : "You still went";

  return (
    <section
      aria-labelledby="checkin-title"
      data-checkin={phase.kind}
      className="mt-8 rounded-card border-(length:--border-frame) border-ink bg-paper p-5 shadow-panel"
    >
      <div className={cn("flex gap-3", phase.kind === "here" || (phase.kind === "result" && phase.verified) ? "items-center" : "items-start")}>
        {phase.kind === "here" || (phase.kind === "result" && phase.verified) ? (
          // Larry's verified moment: his face, with the check-in mark on the corner.
          <span className="relative shrink-0" data-larry-moment={phase.kind === "here" ? "here" : "verified"}>
            <LarryAvatar size="lg" decorative />
            <span aria-hidden className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-ink text-paper ring-2 ring-paper">
              {phase.kind === "here" ? <MapPinCheck className="size-3.5" /> : <BadgeCheck className="size-3.5" />}
            </span>
          </span>
        ) : (
          <MapPinCheck aria-hidden className="mt-1 size-7 shrink-0" />
        )}
        <h2 id="checkin-title" ref={heading} tabIndex={-1} className="font-display text-intro font-black leading-tight outline-none">
          {title}
        </h2>
      </div>

      {phase.kind === "idle" && (
        <>
          <p className="mt-2 text-ink">Tap when you get there, and again when you leave. Visits count after 20 minutes.</p>
          <p className="mt-1 flex items-center gap-1.5 text-label text-ink-soft">
            <Lock className="size-4 shrink-0" aria-hidden /> Your location is checked once per tap, then thrown away.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={doArrive} className={cn(buttonStyles.primary, "min-h-12")}>
              <MapPinCheck className="size-5" aria-hidden /> I&apos;m here
            </button>
            <button type="button" onClick={onClose} className={cn(buttonStyles.quiet, "min-h-12")}>
              Not now
            </button>
          </div>
        </>
      )}

      {(phase.kind === "locating" || phase.kind === "leaving") && (
        <p role="status" className="mt-3 flex items-center gap-2 font-bold">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> One location check, then it&apos;s thrown away.
        </p>
      )}

      {phase.kind === "refused" && (
        <>
          <p role="status" className="mt-2 text-lead text-ink">
            {phase.line}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {phase.permission ? (
              <LinkButton href={LOCATION_SETTINGS_HREF} className="min-h-12">
                Open Settings
              </LinkButton>
            ) : (
              <button type="button" onClick={doArrive} className={cn(buttonStyles.primary, "min-h-12")}>
                <RotateCw className="size-5" aria-hidden /> Try again
              </button>
            )}
            <button type="button" onClick={onClose} className={cn(buttonStyles.secondary, "min-h-12")}>
              Close
            </button>
          </div>
        </>
      )}

      {phase.kind === "here" && atPlace && (
        <>
          <p className="mt-2 text-ink">
            {dwellDone(atPlace, shownAt)
              ? "Tap Leave on your way out. You can close the app until then."
              : "Tap Leave on your way out. Visits count after 20 minutes, and you can close the app until then."}
          </p>
          {phase.note && (
            <p role="status" className="mt-2 font-bold text-ink">
              {phase.note}
            </p>
          )}
          {step?.opener && (
            <>
              <p className="mt-4 font-bold">Say this, or show it:</p>
              <p className="mt-1 rounded-mini bg-table p-3 text-title-sm font-bold leading-snug">{step.opener}</p>
              <ShowThis line={step.opener} className="mt-2" />
            </>
          )}
          {step?.planB && <p className="mt-2 text-ink">{step.planB}</p>}
          <button
            type="button"
            aria-pressed={saidHi}
            onClick={() => setSaidHi((v) => !v)}
            className={cn(buttonStyles.secondary, "mt-4 min-h-12", saidHi && "border-ink bg-ink text-paper hover:bg-ink-hover")}
          >
            {saidHi ? <Check className="size-5" aria-hidden /> : <Hand className="size-5" aria-hidden />} I said hi
          </button>
          {adult && (
            <div className="mt-4 rounded-mini bg-table p-3">
              <p className="font-bold">Want to say hello to someone here?</p>
              <p className="mt-1 text-label text-ink">
                Open to meet shows only your shared tastes, never your name or where you&apos;ve been. Nothing happens unless you both wave.
                18+.
              </p>
              <LinkButton href={`/meet/${encodeURIComponent(atPlace.placeId)}`} variant="secondary" className="mt-3 min-h-12 px-4">
                <Hand className="size-4" aria-hidden /> Open to meet here
              </LinkButton>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={doLeave} className={cn(buttonStyles.primary, "min-h-12")}>
              <DoorOpen className="size-5" aria-hidden /> I&apos;m heading off
            </button>
            <button type="button" onClick={onClose} className={cn(buttonStyles.quiet, "min-h-12")}>
              Hide for now
            </button>
          </div>
        </>
      )}

      {phase.kind === "too-soon" && atPlace && (
        <>
          <p role="status" className="mt-2 text-lead text-ink">
            {leaveReasonLine("too-soon", name)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => toPhase({ kind: "here" })} className={cn(buttonStyles.primary, "min-h-12")}>
              Still here
            </button>
            <button
              type="button"
              onClick={() => finish(atPlace, false, "too-soon", 0, saidHi)}
              className={cn(buttonStyles.secondary, "min-h-12")}
            >
              I&apos;ve left
            </button>
          </div>
        </>
      )}

      {phase.kind === "result" && !phase.verified && (
        <>
          <p role="status" className="mt-2 text-lead text-ink">
            {phase.reason ? leaveReasonLine(phase.reason, name) : ERROR_LINE}
          </p>
          {phase.fold && (
            <p className="mt-1 text-ink-soft">It&apos;s in Your places as Visited. Stages and Glory need the full 20 minutes.</p>
          )}
          <button type="button" onClick={onClose} className={cn(buttonStyles.secondary, "mt-4 min-h-12")}>
            Close
          </button>
        </>
      )}

      {phase.kind === "result" && phase.verified && phase.fold && (
        <CountedResult
          phase={phase}
          step={step}
          reality={reality}
          glad={glad}
          line={line}
          repeatSaved={repeatSaved}
          onReality={setReality}
          onGlad={setGlad}
          onAsk={() => askLarry(reality, glad)}
          onRepeat={() => {
            onSaveRepeat({
              placeId: phase.fold!.counter.placeId,
              placeName: phase.fold!.counter.placeName,
              when: phase.when,
              ...(step?.vibe ? { vibe: step.vibe } : {}),
            });
            setRepeatSaved(true);
          }}
          onNext={onNext ? () => onNext(feelingFromReality(reality) ?? "okay") : undefined}
          onClose={onClose}
        />
      )}
      {phase.kind === "result" && phase.verified && offerApp && line && line !== "asking" && (
        <AppCard placement="win" reason="check-in" className="mt-4" />
      )}
    </section>
  );
}

function CountedResult({
  phase,
  step,
  reality,
  glad,
  line,
  repeatSaved,
  onReality,
  onGlad,
  onAsk,
  onRepeat,
  onNext,
  onClose,
}: {
  phase: Extract<Phase, { kind: "result" }>;
  step?: CheckInStep;
  reality: FaceValue | null;
  glad: Glad | null;
  line: WittyResult | "asking" | null;
  repeatSaved: boolean;
  onReality: (v: FaceValue) => void;
  onGlad: (g: Glad) => void;
  onAsk: () => void;
  onRepeat: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const fold = phase.fold!;
  const c = fold.counter;
  const stage = c.stage ? TITLES[c.stage] : null;
  const spot = fold.newWeek ? spotLine(c) : null;
  const next = nextStageLine(c.visits);
  const worse = !!(step?.guess && reality && reality < step.guess);
  return (
    <>
      {/* The Glory moment: total, this visit's gain and a fresh badge for a stage reached here. */}
      <GloryMoment total={phase.glory} gain={phase.gain} placeName={c.placeName} stageEarned={fold.stageEarned ? (c.stage ?? null) : null} className="mt-3" />
      <p role="status" className="mt-3 text-ink">
        {fold.stageEarned && stage ? `You're a ${stage.word} here now. ` : ""}
        {spot ? `${spot} ` : ""}
        {next ?? ""}
      </p>

      {line === null && (
        <div className="mt-6">
          <RealityPicker reality={reality} glad={glad} onReality={onReality} onGlad={onGlad} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onAsk} className={cn(buttonStyles.primary, "min-h-12")}>
              Done
            </button>
            {reality === null && glad === null && (
              <button type="button" onClick={onAsk} className={cn(buttonStyles.quiet, "min-h-12")}>
                Skip
              </button>
            )}
          </div>
        </div>
      )}
      {line === "asking" && (
        <p role="status" className="mt-6 flex items-center gap-2 font-bold">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is thinking…
        </p>
      )}
      {line && line !== "asking" && (
        <>
          <GuessReveal guess={step?.guess} reality={reality} />
          <div className="mt-4 flex items-start gap-3 rounded-mini bg-ink p-3 text-paper" data-surface="inverse">
            <LarryAvatar size="md" decorative />
            <p>
              <span className="font-bold">{APP_NAME}: </span>
              {line.line}
            </p>
          </div>
          {worse && <p className="mt-2 text-ink">Want something calmer next time? {APP_NAME} can pick one.</p>}
          <p className="mt-2 flex items-center gap-1.5 text-label text-ink-soft">
            <Lock className="size-4 shrink-0" aria-hidden /> Only you see this.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {repeatSaved ? (
              <p role="status" className="flex min-h-12 items-center gap-2 font-bold">
                <Check className="size-5" aria-hidden /> Saved: {c.placeName}, {phase.when}.
              </p>
            ) : (
              <button type="button" onClick={onRepeat} className={cn(buttonStyles.primary, "min-h-12")}>
                <CalendarPlus className="size-5" aria-hidden /> Same place, same time next week?
              </button>
            )}
            {onNext && (
              <button type="button" onClick={onNext} className={cn(buttonStyles.secondary, "min-h-12")}>
                {worse ? "Find a calmer place" : "Pick my next place"}
              </button>
            )}
            <button type="button" onClick={onClose} className={cn(buttonStyles.quiet, "min-h-12")}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
