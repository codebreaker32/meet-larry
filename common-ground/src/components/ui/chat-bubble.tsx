import { LarryAvatar } from "@/components/larry-avatar";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The one chat bubble, for pair sessions, rooms and Talk taste (DESIGN.md Chat).
 *
 * - sender "larry": an ink bubble with Larry's mascot, named "Larry (AI pal)" so Larry is always
 *   labelled an AI. `quiet` (Larry stepped back) turns it paper with ink-soft words and a line ring,
 *   a tone change, never a fade.
 * - sender "person": a paper bubble with a 2px ring in the person's seat colour and an initial tile in
 *   the same colour. The seat colour is a marker beside the name, never the name's colour (the Frame
 *   Rule). With no seat colour, the ring and tile are ink on paper.
 * - The name line adds, in words: "(practice character)", ", to Larry" and ", not seen by Larry"
 *   (sent while Larry was excused). `showName={false}` keeps it for screen readers only, for later
 *   messages in a run from the same sender.
 * - `align="end"` puts the bubble on the right (this phone's person, or seat a).
 * - `footer` sits under the bubble ("Sending…", what Larry just did).
 */
export type ChatSender = "larry" | "person";

export interface ChatBubbleProps {
  sender: ChatSender;
  /** The person's name. Ignored for Larry, who is always APP_NAME. */
  name?: string;
  /** The letter on the person's tile, when the name line says something else ("You"). Default: the name's first letter. */
  initial?: string;
  /** A seat colour as a CSS value, ideally a token: "var(--seat-1)". */
  seatColor?: string;
  align?: "start" | "end";
  quiet?: boolean;
  excused?: boolean;
  /** A made-up practice character: said in the name line. */
  practice?: boolean;
  /** A person's line addressed to Larry in a room. */
  toLarry?: boolean;
  showName?: boolean;
  /** "hide-on-phone" drops the person's tile on narrow screens (your own lines in a room). */
  avatar?: "show" | "hide-on-phone";
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function ChatBubble({
  sender,
  name,
  initial,
  seatColor,
  align = "start",
  quiet = false,
  excused = false,
  practice = false,
  toLarry = false,
  showName = true,
  avatar = "show",
  footer,
  className,
  children,
}: ChatBubbleProps) {
  const isLarry = sender === "larry";
  const who = isLarry ? APP_NAME : (name ?? "Someone");
  const end = align === "end";
  return (
    <div data-bubble={sender} className={cn("flex items-end gap-2", end && "flex-row-reverse", className)}>
      {isLarry ? (
        <LarryAvatar size="md" quiet={quiet} />
      ) : (
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-tile font-display text-caption font-black text-ink",
            !seatColor && "bg-paper ring-2 ring-ink",
            avatar === "hide-on-phone" && "max-sm:hidden",
          )}
          style={seatColor ? { background: seatColor } : undefined}
        >
          {(initial ?? who).charAt(0).toUpperCase()}
        </span>
      )}
      <div className={cn("max-w-[85%] sm:max-w-[80%]", end && "text-right")}>
        <p className={cn("mb-1 px-1 text-label font-bold text-ink-soft", !showName && "sr-only")}>
          {who}
          {isLarry && " (AI pal)"}
          {!isLarry && practice && " (practice pal)"}
          {!isLarry && toLarry && `, to ${APP_NAME}`}
          {excused && `, not seen by ${APP_NAME}`}
        </p>
        <div
          className={cn(
            "inline-block whitespace-pre-line rounded-bubble px-4 py-2.5 text-left text-body leading-snug",
            isLarry
              ? quiet
                ? "bg-paper text-ink-soft ring-2 ring-line"
                : "bg-ink text-paper"
              : "bg-paper text-ink ring-2 ring-ink",
          )}
          style={!isLarry && seatColor ? ({ "--tw-ring-color": seatColor } as React.CSSProperties) : undefined}
        >
          {children}
        </div>
        {footer && <div className="mt-0.5 px-1 text-caption text-ink-soft">{footer}</div>}
      </div>
    </div>
  );
}
