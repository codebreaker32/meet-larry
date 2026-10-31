"use client";

import { AppCard, showAppCardAfterWin } from "@/components/app-card";
import * as React from "react";
import Link from "next/link";
import { Check, Footprints, Loader2, MapPin, MessageCircle } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { OpenerCard } from "@/components/opener-card";
import { PlaceCard, type FitPeople } from "@/components/place-card";
import { ShareStep } from "@/components/share-step";
import { type MatchDayTicketInfo, MatchDayTicketLines } from "@/components/signals/match-day";
import { WhyHere } from "@/components/signals/why-here";
import { Poster } from "@/components/taste-card";
import { FaceScale, type FaceValue } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import type { PlanTicket } from "@/lib/contracts";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import { readStoredLocation } from "@/lib/location";
import { requestSignals, useMood } from "@/lib/mood";
import { addSteps, readStored, writeStored } from "@/lib/storage";
import {
  fetchPlanB,
  fetchTicketExtras,
  guessAllowed,
  ifThenLine,
  ifThenSpoken,
  isoWeekId,
  OBSTACLES,
  planBFor,
  routeLineFallback,
  stepFromTicket,
  ticketTimes,
  walkText,
  withExtras,
  type Obstacle,
  type PlanDraft,
  type TicketExtras,
} from "@/lib/suggest-steps";
import type { Mood } from "@/lib/types/signals";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";
import { cn } from "@/lib/utils";

/**
 * The if-then Plan Ticket: the one concrete real-world plan a session ends on. A real place (with
 * why each person would like it), a real day and time (Qloo's hours, else Amazon's, else a sensible
 * daytime slot with "check before you go"), the walking time, an optional second stop in walking
 * order, the shared thing to bring up, Larry's opener, an optional plan B for the worry that might
 * stop them, an optional weekly guess, and the one if-then line the person commits to with "I'm in".
 * It is saved as a First Step on this phone and can be shared. It is never a booking.
 */
export type PlanTicketVariant = "panel" | "dialog";
export type PlanTicketAfterSave = "share" | "close";

export function PlanTicketView({
  ticket,
  people,
  withPerson,
  ownerName,
  variant = "panel",
  afterSave = "share",
  onOther,
  onCancel,
  onSaved,
  onDone,
  autoFocus = true,
  location,
  picks,
  mood: moodProp,
  commitLabel = "I'm in",
  matchDay,
  whyHere,
  groupSize,
  className,
}: {
  ticket: PlanTicket;
  /** Names and seat colours for the per-person fit lines. */
  people?: FitPeople;
  /** The saved step is "with" them (and they get the share code). */
  withPerson?: string;
  /** Whose phone this is: the shared copy is "with" them. */
  ownerName?: string;
  /** "panel": a framed panel of its own (pair and solo sessions). "dialog": unframed, inside a Dialog that frames it. */
  variant?: PlanTicketVariant;
  /** "share": offer the QR code and link after saving (one phone shared by two). "close": just finish,
   *  for solo chats and rooms, where everyone has their own phone. */
  afterSave?: PlanTicketAfterSave;
  /** "Other ideas": go to the plain First Step list instead. */
  onOther?: () => void;
  /** "Keep talking": back to the chat. */
  onCancel?: () => void;
  onSaved?: (step: PlanDraft) => void;
  onDone: () => void;
  /** Move focus to "Your plan" when the ticket opens, so keyboard and screen-reader users land on it. */
  autoFocus?: boolean;
  /** Where they are (if shared), so "I can't get there" can find a real nearer place. */
  location?: { lat: number; lon: number } | null;
  /** Pick ids for that search when the ticket has no shared item. */
  picks?: string[];
  /** Today's mood; defaults to the one picked on this phone. Low energy gets gentler, shorter lines. */
  mood?: Mood | null;
  commitLabel?: string;
  /**
   * Match Day variant (also when `ticket.variant === "matchday"`): the sourced fixture line, or the
   * honest off-season line, plus "Larry can't promise a TV". Never a dateless "next game".
   */
  matchDay?: MatchDayTicketInfo;
  /** The area line from the server, shown with its "Why here?" sentence only in groups of 3-5. */
  whyHere?: string | null;
  /** People in the group, including you (2-5). Decides whether "Why here?" may show. */
  groupSize?: number;
  className?: string;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const storedMood = useMood();
  const mood = moodProp !== undefined ? moodProp : (storedMood ?? null);
  const low = mood === "low-energy";
  // Read once, so the time chips don't shift while someone is choosing.
  const [now] = React.useState(() => new Date());
  // Larry fills the ticket in once it opens: hours (Amazon when Qloo has none), walking time, a
  // second stop and a fresh opener. Until then (or if it fails) the ticket works as it is.
  const [extras, setExtras] = React.useState<TicketExtras | null>(null);
  const [filling, setFilling] = React.useState(true);
  const t = React.useMemo(() => withExtras(ticket, extras), [ticket, extras]);
  const { choices, checkDoor } = React.useMemo(() => ticketTimes(t, now), [t, now]);
  const [when, setWhen] = React.useState<string | null>(null);
  const chosenWhen = when && choices.includes(when) ? when : choices[0];
  const [obstacle, setObstacle] = React.useState<Obstacle | null>(null);
  // Larry's plan B for each worry tapped (asked once per worry); the fixed line shows meanwhile.
  const [larryPlanB, setLarryPlanB] = React.useState<Partial<Record<Obstacle, string>>>({});
  const [askingPlanB, setAskingPlanB] = React.useState<Obstacle | null>(null);
  const [withRoute, setWithRoute] = React.useState(false);
  const [canGuess] = React.useState(() => guessAllowed(readStored<unknown>(STORAGE_KEYS.guessWeek, null), new Date()));
  const [guess, setGuess] = React.useState<FaceValue | null>(null);
  const [saved, setSaved] = React.useState<PlanDraft | null>(null);
  // Saving writes to this phone's storage, which can fail (private browsing, a full phone).
  const [saveError, setSaveError] = React.useState(false);
  // The app card may follow a first saved plan (never on a first visit; it decides that itself).
  const [offerApp, setOfferApp] = React.useState(false);
  const savingRef = React.useRef(false);
  const id = React.useId();

  React.useEffect(() => {
    let live = true;
    const start = location ?? readStoredLocation();
    const signals = requestSignals();
    void fetchTicketExtras(
      {
        kind: "ticket",
        place: {
          id: ticket.place.id,
          name: ticket.place.name,
          ...(ticket.place.hours ? { hours: ticket.place.hours } : {}),
          ...(ticket.place.slots?.length ? { slots: ticket.place.slots.slice(0, 6) } : {}),
          ...(ticket.place.vibe ? { vibe: ticket.place.vibe } : {}),
          tags: ticket.place.tags.slice(0, 8),
          ...(ticket.place.reason ? { reason: ticket.place.reason.slice(0, 300) } : {}),
          ...(ticket.place.at ? { at: ticket.place.at } : {}),
        },
        ...(ticket.item ? { item: { id: ticket.item.id, name: ticket.item.name } } : {}),
        ...(picks?.length ? { picks: picks.slice(0, 10) } : {}),
        opener: ticket.opener,
        ...(start ? { start: { lat: start.lat, lon: start.lon } } : {}),
        ...(Object.keys(signals).length ? { signals } : {}),
        // Larry's own second stop from the chat: the route is ordered and written around it.
        ...(ticket.then
          ? {
              then: {
                id: ticket.then.place.id,
                name: ticket.then.place.name,
                ...(ticket.then.place.vibe ? { vibe: ticket.then.place.vibe } : {}),
                ...(ticket.then.place.reason ? { reason: ticket.then.place.reason.slice(0, 300) } : {}),
              },
            }
          : {}),
      },
      apiFetch,
    )
      .then((x) => live && setExtras(x))
      .finally(() => live && setFilling(false));
    return () => {
      live = false;
    };
    // Once per ticket: the place id names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.place.id]);

  const planB = obstacle ? (larryPlanB[obstacle] ?? planBFor(obstacle, t)) : t.planB;
  const fromLarry = !obstacle || !!larryPlanB[obstacle];
  // Amazon-ordered route from /api/suggest; until it answers (or if it can't), Larry's own second
  // stop from the chat (PlanTicket.then) with its venue-to-venue walk and the fixed route line.
  const route = React.useMemo<TicketExtras["route"]>(() => {
    if (extras?.route) return extras.route;
    if (!ticket.then || filling) return undefined;
    const stops = [
      { id: ticket.place.id, name: ticket.place.name },
      { id: ticket.then.place.id, name: ticket.then.place.name },
    ];
    const walks = [ticket.then.walkMin ?? null];
    return { stops, walks, line: ticket.then.todo ? `${routeLineFallback(stops, walks)} ${ticket.then.todo}` : routeLineFallback(stops, walks), fromLarry: false };
  }, [extras, ticket, filling]);
  const nextStop = route && withRoute ? route.stops.find((s) => s.id !== t.place.id) : undefined;
  const nextWalk = nextStop && route ? route.walks[route.stops.indexOf(nextStop) - 1] : null;
  const ifThen = chosenWhen
    ? ifThenLine(t, chosenWhen, t.opener, { mood }) +
      (nextStop ? ` Then I walk${nextWalk ? ` ${nextWalk} min` : ""} to ${nextStop.name}.` : "")
    : "";

  const chooseObstacle = (o: Obstacle) => {
    const next = obstacle === o ? null : o;
    setObstacle(next);
    if (!next || larryPlanB[next] || askingPlanB) return;
    setAskingPlanB(next);
    const signals = requestSignals();
    void fetchPlanB(
      {
        kind: "plan_b",
        obstacle: next,
        place: { id: t.place.id, name: t.place.name, ...(t.place.vibe ? { vibe: t.place.vibe } : {}), tags: t.place.tags.slice(0, 5), ...(t.place.at ? { at: t.place.at } : {}) },
        ...(t.item ? { item: { id: t.item.id, name: t.item.name } } : {}),
        ...(picks?.length ? { picks: picks.slice(0, 10) } : {}),
        ...(location ? { location } : {}),
        ...(Object.keys(signals).length ? { signals } : {}),
      },
      apiFetch,
    )
      .then((r) => {
        // Only Larry's own line replaces the fixed one; a server fallback adds nothing new.
        if (r && (!r.fallback || r.nearer)) setLarryPlanB((m) => ({ ...m, [next]: r.planB }));
      })
      .finally(() => setAskingPlanB(null));
  };
  const item = t.item;

  // On opening, and again after saving: focus the heading, so the new panel is announced.
  React.useEffect(() => {
    if (!saved && !autoFocus) return;
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [saved, autoFocus]);

  const commit = () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError(false);
    // Each accepted ticket gets an id, for co-presence later.
    const ticketId = ticket.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now().toString(36)}`);
    const draft = stepFromTicket(
      { ...t, id: ticketId, ...(mood ? { mood } : {}) },
      { when: chosenWhen, planB, withPerson, ifThen, ...(guess ? { guess } : {}), ...(obstacle ? { obstacle } : {}) },
    );
    try {
      addSteps([draft]);
      if (guess) writeStored(STORAGE_KEYS.guessWeek, isoWeekId(new Date()));
    } catch {
      // Nothing was saved: say so warmly and let them tap again.
      savingRef.current = false;
      setSaveError(true);
      return;
    }
    onSaved?.(draft);
    setSaved(draft);
    setOfferApp(showAppCardAfterWin("plan-ticket"));
  };

  const framed = variant === "panel";
  const frame = framed ? "max-h-(--panel-max-h) scroll-pb-48 overflow-y-auto rounded-panel border-2 border-ink bg-paper p-4 shadow-panel" : "";

  if (saved && afterSave === "share") {
    return (
      <ShareStep
        steps={[saved]}
        withPerson={withPerson}
        ownerName={ownerName}
        headingRef={headingRef}
        onDone={onDone}
        cardLabel="Our plan"
        title={withPerson ? `You're in. Give ${withPerson} a copy of the plan` : "You're in. Share the plan"}
        note={
          <>
            <p className="text-label text-ink-soft">It&apos;s a plan, not a booking. Tell a friend where you&apos;re going.</p>
          </>
        }
      />
    );
  }

  if (saved) {
    return (
      <section aria-labelledby={`${id}-saved`} className={cn(frame, className)}>
        <h2 id={`${id}-saved`} ref={headingRef} tabIndex={-1} className="font-display text-title-sm font-black leading-tight outline-none">
          You&apos;re in
        </h2>
        <p className="mt-1 font-bold">{saved.ifThen ?? saved.text}</p>
        <p className="mt-1 text-label text-ink-soft">Saved to your First Steps.</p>
        <p className="mt-1 text-label text-ink-soft">It&apos;s a plan, not a booking. Tell a friend where you&apos;re going.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/steps" className={cn(buttonStyles.secondary, "min-h-12")}>
            See my First Steps
          </Link>
          <button type="button" onClick={onDone} className={cn(buttonStyles.primary, "min-h-12")}>
            Done
          </button>
        </div>
        {offerApp && <AppCard placement="win" reason="plan-ticket" className="mt-4" />}
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className={cn(frame, className)}>
      <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="font-display text-title-sm font-black leading-tight outline-none">
        Your plan
      </h2>
      <p className="text-ink-soft">
        {APP_NAME} (an AI) picked this real place{withPerson ? ` for you and ${withPerson}` : ""}.
      </p>

      <PlaceCard place={t.place} people={people} size="lg" className="mt-3" />
      {(extras?.walkMin !== undefined || extras?.hoursFrom === "amazon") && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink">
          {extras?.walkMin !== undefined && (
            <span className="inline-flex items-center gap-1.5 font-bold">
              <Footprints className="size-4" aria-hidden /> About a {walkText(extras.walkMin)} from you
            </span>
          )}
          {extras?.hoursFrom === "amazon" && t.place.hours && <span className="text-ink-soft">Hours: {t.place.hours} (from Amazon Location)</span>}
        </p>
      )}
      <WhyHere line={whyHere} groupSize={groupSize} />
      {(matchDay || ticket.variant === "matchday") && <MatchDayTicketLines info={matchDay ?? {}} className="mt-3" />}

      <h3 id={`${id}-when`} className="mt-4 font-bold">
        When
      </h3>
      <div role="group" aria-labelledby={`${id}-when`} hidden={choices.length === 0} className="mt-2 flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={c === chosenWhen}
            onClick={() => setWhen(c)}
            className={cn(
              "press press-soft min-h-12 rounded-full border-2 px-4 font-bold",
              c === chosenWhen ? "border-ink bg-ink text-paper" : "border-border-subtle bg-table text-ink hover:border-border-control",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      {choices.length === 0 ? (
        // No daytime time fits the place's hours (closed all week, or night-only): never invent one.
        <p className="mt-1 font-bold text-ink">
          {t.place.name} isn&apos;t open in the daytime soon.{" "}
          {onOther ? "Tap Other ideas for another place." : "Pick a time when you check its hours."}
        </p>
      ) : (
        <p className="mt-1 text-label text-ink-soft" data-testid="ticket-hours-note">
          {checkDoor
            ? filling
              ? "Checking its opening hours…"
              : "We don't know its hours yet, so this is a good daytime guess. Check before you go."
            : "Daytime only, when it's open. Check the hours again before you go."}
        </p>
      )}

      {route && route.stops.length >= 2 && !low && (
        <>
          <h3 className="mt-4 font-bold">Make it a little outing?</h3>
          <ol className="mt-2 grid gap-1">
            {route.stops.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0" aria-hidden />
                <span className="font-bold">{s.name}</span>
                {s.kind && <span className="text-label text-ink-soft">{s.kind}</span>}
                {i > 0 && route.walks[i - 1] ? <span className="text-label text-ink-soft">({walkText(route.walks[i - 1]!)})</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-1">{route.line}</p>
          {route.fromLarry && <p className="text-label text-ink-soft">Route from {APP_NAME}, ordered with Amazon Location.</p>}
          <button
            type="button"
            aria-pressed={withRoute}
            onClick={() => setWithRoute((v) => !v)}
            className={cn(
              "press press-soft mt-2 min-h-12 rounded-full border-2 px-4 font-bold",
              withRoute ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
            )}
          >
            {withRoute ? "Added to my plan" : "Add it to my plan"}
          </button>
        </>
      )}

      {t.todo && (
        <>
          <h3 className="mt-4 font-bold">What to do there</h3>
          <p className="mt-1">{t.todo}</p>
        </>
      )}

      {item && (
        <>
          <h3 className="mt-4 font-bold">Bring up</h3>
          <div className="mt-2 flex items-center gap-3 rounded-mini border-(length:--border-frame) bg-paper p-2" style={{ borderColor: DOMAIN_STYLE[item.domain].color }}>
            <Poster item={item} className="h-20 w-14 shrink-0" sizes="72px" />
            <div className="min-w-0">
              <p className="text-caption font-bold text-ink-soft">{DOMAIN_STYLE[item.domain].label}</p>
              <p className="font-display text-body font-black leading-tight">{item.name}</p>
              <p className="mt-1 text-label text-ink">Show it on your phone, or just ask about it.</p>
            </div>
          </div>
        </>
      )}

      <h3 className="mt-4 font-bold">Say this, or show it</h3>
      <p className="mt-2 flex items-start gap-3 rounded-mini bg-table p-3 text-title-sm font-bold leading-snug text-ink" data-testid="ticket-opener">
        <MessageCircle className="mt-1.5 size-6 shrink-0" aria-hidden />
        <span>{t.opener}</span>
      </p>
      <OpenerCard line={t.opener} item={item} className="mt-2" />

      <h3 id={`${id}-planb`} className="mt-4 font-bold">
        What might get in the way?
      </h3>
      <p className="text-label text-ink-soft">Optional. Tap one and you get a plan B.</p>
      <div role="group" aria-labelledby={`${id}-planb`} className="mt-2 grid gap-2 sm:grid-cols-2">
        {OBSTACLES.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={obstacle === o.id}
            onClick={() => chooseObstacle(o.id)}
            className={cn(
              "press press-soft min-h-12 rounded-full border-2 px-4 text-left font-bold",
              obstacle === o.id ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {planB && (
        <p role="status" className="mt-3 rounded-mini border-2 border-ink bg-paper p-3 font-bold leading-snug">
          <span className="sr-only">Plan B: </span>
          {planB}
          {askingPlanB && askingPlanB === obstacle ? (
            <span className="mt-1 flex items-center gap-1.5 text-label font-normal text-ink-soft">
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is finding a better plan B…
            </span>
          ) : (
            fromLarry && <span className="mt-1 block text-label font-normal text-ink-soft">Plan B from {APP_NAME}.</span>
          )}
        </p>
      )}

      {canGuess && (
        <div className="mt-4">
          <FaceScale label="How do you think it'll go? (optional)" value={guess} onChange={setGuess} labelClassName="font-bold" />
          <p className="mt-1 text-label text-ink-soft">Just for you. Afterwards you can see how it really went.</p>
        </div>
      )}

      {(onCancel || onOther) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className={cn(buttonStyles.quiet, "px-3 text-label")}>
              Keep talking
            </button>
          )}
          {onOther && (
            <button type="button" onClick={onOther} className={cn(buttonStyles.quiet, "px-3 text-label")}>
              Other ideas
            </button>
          )}
        </div>
      )}

      {/* The stub: the one line they keep, with "I'm in" on it. Pinned to the bottom edge, so it stays in reach while the ticket scrolls. */}
      <div
        className={cn("mt-4 border-t-2 border-dashed border-line bg-paper pt-3", framed && "sticky -bottom-4 -mx-4 -mb-4 px-4 pb-4")}
        data-testid="ticket-stub"
      >
        {ifThen && (
          <p className="text-body font-bold leading-snug text-ink sm:text-title-sm" aria-label={`Your plan: ${ifThenSpoken(ifThen)}`}>
            {ifThen}
          </p>
        )}
        <div className="mt-2 flex items-center justify-end gap-3">
          {saveError ? (
            <p role="alert" className="mr-auto text-label font-bold text-danger">
              Hmm, that didn&apos;t save. Try again in a moment?
            </p>
          ) : (
            <p className="mr-auto text-label text-ink-soft">A plan, not a booking.</p>
          )}
          <button type="button" onClick={commit} className={cn(buttonStyles.primary, "min-h-12 shrink-0")}>
            <Check className="size-5" aria-hidden /> {commitLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
