"use client";

import {
  FaceExpressionless,
  FaceGrinning,
  FaceNeutral,
  FaceSlightlyFrowning,
  FaceSlightlySmiling,
  type LucideIcon,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * Five faces with words, never numbers (R8): Awful, Not great, OK, Good, Great. Used for "How do you
 * think it'll go?" on the Plan Ticket and "How did it go?" after a visit, and in the Guess vs Reality
 * line ("You guessed Not great. It was Good."). The scale is never colour-coded: every face is neutral
 * ink and always has its word. Icons follow component-specs section 6 (each one distinct: Lucide's
 * Frown, Meh, Smile and Laugh are aliases of these, so never mix the two sets).
 *
 * `FaceScale` is the picker (a radiogroup of five equal tiles). `FaceMark` shows one chosen face and
 * word, for the reveal cards.
 */
export type FaceValue = 1 | 2 | 3 | 4 | 5;

export const FACES: readonly { value: FaceValue; word: string; Icon: LucideIcon }[] = [
  { value: 1, word: "Awful", Icon: FaceSlightlyFrowning },
  { value: 2, word: "Not great", Icon: FaceExpressionless },
  { value: 3, word: "OK", Icon: FaceNeutral },
  { value: 4, word: "Good", Icon: FaceSlightlySmiling },
  { value: 5, word: "Great", Icon: FaceGrinning },
];

/** The word for a face value: faceWord(2) is "Not great". */
export function faceWord(value: FaceValue): string {
  return FACES[value - 1].word;
}

export function FaceScale({
  label,
  hideLabel,
  value,
  onChange,
  className,
  labelClassName,
}: {
  /** The question, printed as the group's heading: "How do you think it'll go?" */
  label: React.ReactNode;
  hideLabel?: boolean;
  value: FaceValue | null;
  onChange: (value: FaceValue) => void;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <Segmented<FaceValue>
      label={label}
      hideLabel={hideLabel}
      options={FACES.map(({ value: v, word, Icon }) => ({ value: v, label: word, icon: <Icon /> }))}
      value={value}
      onChange={onChange}
      layout="even"
      size="lg"
      className={className}
      labelClassName={labelClassName}
    />
  );
}

export function FaceMark({ value, className }: { value: FaceValue; className?: string }) {
  const { word, Icon } = FACES[value - 1];
  return (
    <span className={cn("inline-flex flex-col items-center gap-1 text-ink", className)}>
      <Icon className="size-8" aria-hidden />
      <span className="font-display text-title-sm font-black leading-tight">{word}</span>
    </span>
  );
}
