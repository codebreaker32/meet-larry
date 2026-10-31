import Image from "next/image";
import { BadgeCheck, Sun } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

// Larry's mascot: a friendly robot with an ink screen face in a foil frame, holding a heart card.
// It is the face of the app: the header logo, the landing hero, the one location ask, and Larry's
// empty, thinking, verified and Glory moments (<LarryMoment/>).
// Made from brand/larry-avatar.png by scripts/make-icons.mjs. The "face" crop reads at chat size;
// the full mascot is for bigger spots. Never brand/hero.png. Both are transparent cut-outs: the face
// gets a tile and ring (chat size), the full mascot has no box (pass a tile in className if a spot
// needs one, as the landing's small "card on the mat" does).
const SOURCES = {
  face: { src: "/larry-face-192.png", px: 192 },
  full: { src: "/larry-512.png", px: 512 },
} as const;

/** Plain asset paths for places next/image can't reach (share images, Open Graph, canvas). */
export const LARRY_ASSETS = {
  face96: "/larry-face-96.png",
  face192: "/larry-face-192.png",
  face192Webp: "/larry-face-192.webp",
  full192: "/larry-192.png",
  full512: "/larry-512.png",
  full512Webp: "/larry-512.webp",
  appIcon: "/icons/icon-192.png",
} as const;

export const LARRY_ALT = `${APP_NAME}, an AI pal`;

/**
 * xs 24px (composer chips), sm 28px (inline notes), md 36px (chat bubbles), lg 48px (headers),
 * xl 96px (the location ask, empty states), 2xl 144px (verified and Glory moments),
 * hero 180px on phones and 320px on desktop (the landing).
 */
export type LarryAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "hero";

const SIZE: Record<LarryAvatarSize, { sizes: string; className: string }> = {
  xs: { sizes: "24px", className: "size-6" },
  sm: { sizes: "28px", className: "size-7" },
  md: { sizes: "36px", className: "size-9" },
  lg: { sizes: "48px", className: "size-12" },
  xl: { sizes: "96px", className: "size-24" },
  "2xl": { sizes: "144px", className: "size-36" },
  hero: { sizes: "(min-width: 1024px) 320px, 180px", className: "size-45 lg:size-80" },
};

// Big avatars are cards on the table: a wider radius than a chat tile.
const RADIUS: Record<LarryAvatarSize, string> = {
  xs: "rounded-tile",
  sm: "rounded-tile",
  md: "rounded-tile",
  lg: "rounded-tile",
  xl: "rounded-mini",
  "2xl": "rounded-card",
  hero: "rounded-card",
};

export function LarryAvatar({
  size = "md",
  variant = "face",
  quiet = false,
  decorative = false,
  eager = false,
  className,
}: {
  size?: LarryAvatarSize;
  variant?: keyof typeof SOURCES;
  /** Larry has stepped back: a line ring instead of an ink ring (a tone change, never a fade). Face only. */
  quiet?: boolean;
  /** Next to words that already say who it is (a button label): hidden from screen readers. */
  decorative?: boolean;
  /** Above the fold (the landing hero): load it at once, high priority (Next 16: not `priority`). */
  eager?: boolean;
  className?: string;
}) {
  const source = SOURCES[variant];
  return (
    <Image
      src={source.src}
      width={source.px}
      height={source.px}
      sizes={SIZE[size].sizes}
      alt={decorative ? "" : LARRY_ALT}
      aria-hidden={decorative || undefined}
      draggable={false}
      loading={eager ? "eager" : undefined}
      fetchPriority={eager ? "high" : undefined}
      className={cn(
        "shrink-0 object-contain",
        SIZE[size].className,
        // The art is a transparent cut-out. The face crop is cut off at its edges, so at chat size it
        // sits on a small table-coloured tile with an ink ring (the screen stays readable on ink, too).
        // The full mascot stands on its own: no box behind it.
        variant === "face" && cn("bg-table ring-2", RADIUS[size], quiet ? "ring-line" : "ring-ink"),
        className,
      )}
    />
  );
}

/** The four moments where Larry shows up big. */
export type LarryMomentKind = "empty" | "thinking" | "verified" | "glory";

const MOMENT_DEFAULT: Record<LarryMomentKind, string> = {
  empty: "Nothing here yet. Larry is ready when you are.",
  thinking: "Larry is thinking",
  verified: "Check-in verified. Nice one.",
  glory: "You earned Glory.",
};

/**
 * Larry's avatar with one line, for empty states, loading ("Larry is thinking"), a verified
 * check-in and the Glory moment. Pass the real line (model-written where there is one) as `title`;
 * `children` goes under it (a plain line, a button). Neutral marks only: ink, paper, table, line.
 *
 * - thinking: role="status" with three typing dots (still under reduced motion).
 * - verified: a BadgeCheck tile on the avatar's corner. glory: a Sun tile.
 * - layout "stack" (centred, xl avatar) or "row" (avatar left, lg avatar) for tight spots.
 */
export function LarryMoment({
  kind,
  title,
  layout = "stack",
  headingLevel,
  className,
  children,
}: {
  kind: LarryMomentKind;
  title?: React.ReactNode;
  layout?: "stack" | "row";
  /** Render the title as a heading (h2 or h3) instead of a paragraph. */
  headingLevel?: 2 | 3;
  className?: string;
  children?: React.ReactNode;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  const Corner = kind === "verified" ? BadgeCheck : kind === "glory" ? Sun : null;
  const row = layout === "row";
  return (
    <div
      role={kind === "thinking" ? "status" : undefined}
      data-moment={kind}
      className={cn("flex gap-4", row ? "items-center text-left" : "flex-col items-center text-center", className)}
    >
      <span className="relative shrink-0">
        <LarryAvatar variant={row ? "face" : "full"} size={row ? "lg" : kind === "verified" || kind === "glory" ? "2xl" : "xl"} decorative={kind === "thinking"} />
        {Corner && (
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-2 -right-2 grid place-items-center rounded-full bg-ink text-paper ring-2 ring-paper",
              row ? "size-6" : "size-10",
            )}
          >
            <Corner className={row ? "size-4" : "size-6"} />
          </span>
        )}
      </span>
      <div className={cn("flex min-w-0 flex-col gap-2", !row && "items-center")}>
        <Title className={cn("font-bold text-ink", headingLevel && "font-display text-title-sm font-black")}>
          {title ?? MOMENT_DEFAULT[kind]}
          {kind === "thinking" && (
            <span aria-hidden className="ml-1 inline-flex gap-1 align-middle">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-ink motion-safe:animate-[typing_1.2s_ease-in-out_infinite]"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </span>
          )}
        </Title>
        {children}
      </div>
    </div>
  );
}
