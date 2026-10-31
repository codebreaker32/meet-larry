"use client";

import * as React from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { OverlapShare } from "@/components/fingerprint/overlap-share";
import { ShareStep } from "@/components/share-step";
import { fieldStyles } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { STEP_KIND, StepKindPill } from "@/components/step-kind";
import type { SuggestInput } from "@/lib/contracts";
import type { OverlapData } from "@/lib/fingerprint";
import { fetchSuggest } from "@/lib/suggest-steps";
import { signalsField } from "@/lib/mood";
import type { FirstStep, StepKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DraftStep = Omit<FirstStep, "id" | "createdAt" | "done">;

// One AI call per distinct session state: reopening the panel reuses the answer.
const aiCache = new Map<string, Promise<DraftStep[] | null>>();

/**
 * Fresh First Step ideas written by the AI from the real picks, bridges and places (POST
 * /api/suggest kind "steps"). Undefined while loading, null when it failed (use the fixed ones).
 * The input is read once, when the panel opens, so places arriving later don't buy a second call.
 */
export function useAiSteps(input: SuggestInput | undefined): DraftStep[] | null | undefined {
  const [frozen] = React.useState(() => (input ? JSON.stringify({ ...input, kind: "steps" }) : ""));
  const [result, setResult] = React.useState<DraftStep[] | null | undefined>(frozen ? undefined : null);
  React.useEffect(() => {
    if (!frozen) return;
    let live = true;
    let pending = aiCache.get(frozen);
    if (!pending) {
      pending = fetchSuggest({ ...(JSON.parse(frozen) as SuggestInput), ...signalsField() }, undefined, 7000, apiFetch).then((r) =>
        r && r.steps.length
          ? r.steps.slice(0, 3).map((s) => ({ kind: s.kind, text: s.text.trim().slice(0, 140), ...(s.kind === "go" ? { rung: 0 } : {}) }))
          : null,
      );
      aiCache.set(frozen, pending);
      // A failure may be a busy moment: let the next opening try again.
      pending.then((r) => r === null && aiCache.delete(frozen));
    }
    pending.then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [frozen]);
  return result;
}

/**
 * The end of a session: pick or write one real-world First Step, save it on this phone,
 * then hand the other person a QR code so the plan reaches their phone too.
 */
export function EndPanel({
  steps,
  suggestions: fixed,
  withPerson,
  ownerName,
  waiting,
  canKeepTalking,
  intro,
  extra,
  suggestInput,
  overlap: overlapProp,
  onCancel,
  onSave,
  onDone,
}: {
  /** Steps Larry saved during the chat. Selected by default. */
  steps: DraftStep[];
  /** Fixed tap-only ideas from the common ground and places: the fallback when the AI can't write fresh ones. */
  suggestions: DraftStep[];
  /** What the AI may write fresh First Steps from (real picks, bridges and places only). */
  suggestInput?: SuggestInput;
  /**
   * "Our overlap" share image (plan 1E): two first names and what Qloo found. Defaults to the two
   * names and bridges in `suggestInput` (pair sessions only; a practice pal has one name, so none).
   */
  overlap?: OverlapData;
  /** The other person on this phone; the step is "with" them and they get the share code. */
  withPerson?: string;
  /** Whose phone this is; the shared copy is "with" them. */
  ownerName?: string;
  /** Larry is still replying; that reply may add a step, so saving waits. */
  waiting: boolean;
  canKeepTalking: boolean;
  intro?: string;
  /** Shown under the intro, e.g. the solo chat's "Start a group" offer. */
  extra?: React.ReactNode;
  onCancel: () => void;
  onSave: (steps: DraftStep[]) => void;
  onDone: () => void;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const overlap: OverlapData | undefined =
    overlapProp ??
    (suggestInput && suggestInput.names.length === 2 && suggestInput.bridges.length
      ? { names: [suggestInput.names[0], suggestInput.names[1]], shared: [], bridges: suggestInput.bridges }
      : undefined);
  const ai = useAiSteps(suggestInput);
  const ideasLoading = ai === undefined;
  // Larry was asked and couldn't write fresh ideas: the fixed ones from the common ground stand in.
  const ideasFailed = !!suggestInput && ai === null;
  // Fresh AI ideas when they came; a nearby place found later still joins them as a "go" step.
  const lateGo = ai ? fixed.filter((s) => s.kind === "go" && !ai.some((x) => x.kind === "go")).slice(0, 1) : [];
  const suggestions = (ideasLoading ? [] : ai ? [...ai, ...lateGo] : fixed).filter(
    (s) => !steps.some((x) => x.text.trim().toLowerCase() === s.text.trim().toLowerCase()),
  );
  // Track what was turned off, so steps that arrive later start selected.
  const [offLarry, setOffLarry] = React.useState<Set<number>>(new Set());
  // Suggestions are rebuilt as places and steps arrive, so they're tracked by text, not position.
  // Null until someone taps one: until then the first (lowest-pressure) idea is chosen, so the
  // strongest button saves a real step rather than skipping it (every session points outward).
  const [pickedSuggested, setPickedSuggested] = React.useState<Set<string> | null>(null);
  const onSuggested =
    pickedSuggested ?? new Set(steps.length === 0 && suggestions[0] ? [suggestions[0].text] : []);
  const savingRef = React.useRef(false);
  const listRef = React.useRef<HTMLUListElement>(null);
  const [text, setText] = React.useState("");
  const [kind, setKind] = React.useState<StepKind>("go");
  const [saved, setSaved] = React.useState<DraftStep[] | null>(null);

  React.useEffect(() => {
    headingRef.current?.focus();
  }, [saved]);

  const toggle = <T,>(set: Set<T>, i: T) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };

  const chosen: DraftStep[] = [
    ...steps.filter((_, i) => !offLarry.has(i)),
    ...suggestions.filter((s) => onSuggested.has(s.text)),
    ...(text.trim() ? [{ kind, text: text.trim().slice(0, 140) }] : []),
  ].map((s) => ({ ...s, withPerson }));

  // Waiting counts as ready: Larry's reply may add a step, and the button says so.
  const ready = chosen.length > 0 || waiting;

  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  // The strong button with nothing chosen: choose the lowest-pressure idea (it is listed first).
  const pickEasiest = () => {
    const first = suggestions[0];
    if (first) {
      setPickedSuggested(new Set([first.text]));
      return;
    }
    if (ideasLoading) return;
    const d = detailsRef.current;
    if (d) {
      d.open = true;
      requestAnimationFrame(() => d.querySelector("input")?.focus());
    }
  };

  const save = () => {
    if (waiting || savingRef.current) return;
    savingRef.current = true;
    onSave(chosen);
    if (chosen.length && withPerson) setSaved(chosen);
    else onDone();
  };

  if (saved) return <ShareStep steps={saved} withPerson={withPerson!} ownerName={ownerName} headingRef={headingRef} onDone={onDone} />;

  return (
    <section
      aria-labelledby="end-title"
      // Room for the pinned Save row, so a focused choice never scrolls under it.
      className="max-h-(--panel-max-h) scroll-pb-24 overflow-y-auto rounded-panel border-2 border-ink bg-paper p-4 shadow-panel"
    >
      <h2 id="end-title" ref={headingRef} tabIndex={-1} className="font-display text-title-sm font-black focus:outline-none focus-visible:outline-none">
        Save a First Step
      </h2>
      <p className="text-ink-soft">{intro ?? `Pick one small real thing to do${withPerson ? ` with ${withPerson}` : ""}.`}</p>
      {extra}
      {overlap && <OverlapShare overlap={overlap} />}

      <ul ref={listRef} className="mt-3 flex flex-col gap-2">
        {steps.map((s, i) => (
          <StepChoice
            key={`l${i}`}
            step={s}
            note="Larry saved this"
            selected={!offLarry.has(i)}
            onToggle={() => setOffLarry((set) => toggle(set, i))}
          />
        ))}
        {suggestions.map((s) => (
          <StepChoice
            key={`s${s.text}`}
            step={s}
            selected={onSuggested.has(s.text)}
            onToggle={() => setPickedSuggested(toggle(onSuggested, s.text))}
          />
        ))}
        {ideasLoading &&
          [0, 1, 2].map((i) => (
            <li key={`wait${i}`} aria-hidden className="flex min-h-14 items-center gap-3 rounded-tile border-2 border-line bg-paper px-3 py-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="flex-1" />
            </li>
          ))}
      </ul>
      {ideasLoading && (
        <p role="status" className="mt-2 flex items-center gap-2 text-ink-soft">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is writing a few ideas from your picks…
        </p>
      )}
      {ideasFailed && suggestions.length > 0 && (
        <p className="mt-2 text-label text-ink-soft">These ideas come from your common ground. {APP_NAME} can write fresh ones next time.</p>
      )}

      {/* An empty slot to fill in: a dashed outline with a plus, solid once it's open. */}
      <details ref={detailsRef} className="group mt-2 rounded-tile border-2 border-dashed border-border-control bg-paper px-3 open:border-solid open:border-ink open:bg-table">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 font-bold [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink">
            <Plus className="size-5 transition-transform group-open:rotate-45" />
          </span>
          Write your own step
        </summary>
        <div className="flex flex-col gap-2 pb-3 sm:flex-row">
          <label className="sr-only" htmlFor="step-kind">
            Kind of step
          </label>
          <select
            id="step-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as StepKind)}
            className={fieldStyles("sm", "w-auto rounded-tile px-3 font-bold")}
          >
            {(Object.keys(STEP_KIND) as StepKind[]).map((k) => (
              <option key={k} value={k}>
                {STEP_KIND[k].label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="step-text">
            Your own step
          </label>
          <input
            id="step-text"
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Game café on Friday"
            className={fieldStyles("sm", "flex-1 rounded-tile px-3")}
          />
        </div>
      </details>

      {/* Pinned to the panel's bottom edge, so Save stays in reach when the list scrolls. */}
      <div
        className={cn(
          "sticky -bottom-4 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t-2 border-line bg-paper px-4",
          canKeepTalking ? "pb-4 pt-3" : "pb-3 pt-2",
        )}
      >
        {/* Nothing chosen: choosing stays the strong path. Skipping is quiet, never the ink button. */}
        {!ready && (
          <button type="button" onClick={save} className={cn(buttonStyles.quiet, "mr-auto px-3 text-label")}>
            No step today
          </button>
        )}
        {canKeepTalking && (
          <button type="button" onClick={onCancel} className={cn(buttonStyles.quiet, !ready && "px-3 text-label")}>
            Keep talking
          </button>
        )}
        {ready ? (
          <button
            type="button"
            onClick={save}
            aria-disabled={waiting}
            // Waiting: a tone change, so the words stay readable.
            className={cn(
              buttonStyles.primary,
              "min-h-12 aria-disabled:cursor-wait aria-disabled:bg-table aria-disabled:text-ink aria-disabled:shadow-none aria-disabled:ring-2 aria-disabled:ring-line aria-disabled:hover:bg-table",
            )}
          >
            {waiting ? (
              <>
                <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> Waiting for Larry…
              </>
            ) : chosen.length === 1 ? (
              "Save this step"
            ) : (
              `Save ${chosen.length} steps`
            )}
          </button>
        ) : (
          <>
            <span id="pick-hint" className="sr-only">
              Or tap a step above to save it.
            </span>
            <button
              type="button"
              aria-describedby="pick-hint"
              onClick={pickEasiest}
              aria-disabled={ideasLoading && !suggestions.length}
              className={cn(
                buttonStyles.primary,
                "min-h-12 aria-disabled:cursor-wait aria-disabled:bg-table aria-disabled:text-ink aria-disabled:ring-2 aria-disabled:ring-line aria-disabled:hover:bg-table",
              )}
            >
              {suggestions.length || ideasLoading ? "Pick the easiest one" : "Write my own step"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function StepChoice({
  step,
  note,
  selected,
  onToggle,
}: {
  step: DraftStep;
  note?: string;
  selected: boolean;
  onToggle: () => void;
}) {

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={cn(
          "press press-soft flex min-h-14 w-full items-center gap-3 rounded-tile border-2 px-3 py-2 text-left",
          selected ? "border-ink bg-table" : "border-border-subtle bg-paper hover:border-border-control",
        )}
      >
        <StepKindPill kind={step.kind} />
        <span className="min-w-0 flex-1 font-bold leading-snug">
          {step.text}
          {note && <span className="sr-only">. {note}</span>}
        </span>
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full border-2",
            selected ? "border-ink bg-ink text-paper" : "border-border-control",
          )}
        >
          {selected && <Check className="size-5" />}
        </span>
      </button>
    </li>
  );
}
