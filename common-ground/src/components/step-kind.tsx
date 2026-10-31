import { Eye, MapPin, MessageCircle } from "lucide-react";
import type { StepKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The three kinds of First Step. Kinds are shown neutrally (a paper pill, an ink ring, a Lucide
 * icon and the word), never in a domain colour: those five colours mean film, TV, music, games and
 * books, so a teal "Say" would read as music. The one colour a First Step carries is the coral
 * ring that marks it as saved.
 */
export const STEP_KIND: Record<StepKind, { word: string; label: string; Icon: typeof MapPin }> = {
  go: { word: "Go", label: "Go somewhere", Icon: MapPin },
  say: { word: "Say", label: "Say something", Icon: MessageCircle },
  // "Show" steps are songs, trailers or a card shown in person, so an eye, not a QR code.
  show: { word: "Show", label: "Show something", Icon: Eye },
};

export type StepKindPillVariant = "full" | "compact";

/** The kind as a marker beside the step: icon and word on one line, not a label above it. */
export function StepKindPill({
  kind,
  className,
  decorative,
  variant = "full",
}: {
  kind: StepKind;
  className?: string;
  /** Hidden from screen readers, when the kind is already read out with the step. */
  decorative?: boolean;
  /** "full": icon and word. "compact": icon only on phones, so a narrow row keeps room for the step itself. */
  variant?: StepKindPillVariant;
}) {
  const { word, Icon } = STEP_KIND[kind];
  const compact = variant === "compact";
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-paper px-2.5 text-label font-bold text-ink ring-2 ring-ink",
        compact && "max-sm:size-9 max-sm:justify-center max-sm:px-0",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className={cn(compact && "max-sm:sr-only")}>{word}</span>
      <span className="sr-only">.</span>
    </span>
  );
}
