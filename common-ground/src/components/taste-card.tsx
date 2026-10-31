"use client";

import * as React from "react";
import Image from "next/image";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import type { Profile, TasteItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * When a fallback title may show, by its longest word: a word is never broken, so the window must be
 * wide enough for it (about 0.55rem a letter plus the inner padding). Narrower windows show the icon
 * alone; the title is still read out, and on bridge cards it is printed beside the poster.
 * Class names are written out in full so Tailwind generates them.
 */
const TITLE_FIT = [
  { maxLetters: 5, box: "@[3.75rem]:items-start @[3.75rem]:justify-between @[3.75rem]:p-2", text: "@[3.75rem]:line-clamp-4" },
  { maxLetters: 7, box: "@[5rem]:items-start @[5rem]:justify-between @[5rem]:p-2", text: "@[5rem]:line-clamp-4" },
  { maxLetters: 10, box: "@[6.5rem]:items-start @[6.5rem]:justify-between @[6.5rem]:p-2", text: "@[6.5rem]:line-clamp-4" },
  { maxLetters: 14, box: "@[8.75rem]:items-start @[8.75rem]:justify-between @[8.75rem]:p-2", text: "@[8.75rem]:line-clamp-4" },
] as const;

function titleFit(name: string) {
  const longest = Math.max(0, ...name.split(/[\s-]+/).map((w) => w.length));
  return TITLE_FIT.find((t) => longest <= t.maxLetters);
}

/**
 * The title in a poster without art. Whole words only: easy-read never splits "Crossing" into
 * "Crossin / g". The container query above guesses from the letter count; this measures, and hides
 * the title (icon only) when a word is still wider than the window, as with wide capitals.
 */
function FallbackTitle({
  name,
  className,
  tooWide,
  setTooWide,
}: {
  name: string;
  className: string;
  tooWide: boolean;
  setTooWide: (v: boolean) => void;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // Hidden by the container query: nothing to measure yet.
      if (el.clientWidth === 0) return;
      setTooWide(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [name, setTooWide]);
  return (
    <span
      ref={ref}
      // overflow-wrap and word-break normal: a long word overflows (and is measured) instead of breaking.
      className={cn("hidden w-full text-caption font-bold leading-tight break-normal hyphens-none", !tooWide && className)}
    >
      {name}
    </span>
  );
}

/**
 * A poster window: Qloo art when there is some. Without art it becomes a small card back on purpose:
 * the domain colour, an inner frame, the domain icon and the title (the icon alone when the title
 * wouldn't fit without breaking a word). Art that fails to load (a dead link, a slow connection that
 * gives up) falls back to the same card back, never a broken-image icon.
 */
export function Poster({ item, className, sizes = "120px" }: { item: TasteItem; className?: string; sizes?: string }) {
  const { color, Icon, label } = DOMAIN_STYLE[item.domain];
  // Ink on Games violet is too low for text, so the Games fallback uses the lighter violet tint.
  const fallbackBg = item.domain === "videogame" ? "var(--games-tint)" : color;
  const [tooWide, setTooWide] = React.useState(false);
  // The address that failed, so a new item with new art gets its own chance.
  const [failed, setFailed] = React.useState<string | null>(null);
  const image = item.image && item.image !== failed ? item.image : undefined;
  const fit = image ? undefined : titleFit(item.name);
  return (
    <div
      className={cn("@container relative overflow-hidden rounded-tile border-(length:--border-frame)", className)}
      style={{ borderColor: color, background: image ? color : fallbackBg }}
    >
      {image ? (
        <Image src={image} alt="" fill sizes={sizes} className="object-cover" onError={() => setFailed(image)} />
      ) : (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-1 rounded-inner border-2 border-border-subtle" />
          <div aria-hidden className={cn("relative flex h-full flex-col items-center justify-center p-1.5 text-ink", !tooWide && fit?.box)}>
            <Icon className="size-5 shrink-0" aria-hidden />
            {fit && <FallbackTitle name={item.name} className={fit.text} tooWide={tooWide} setTooWide={setTooWide} />}
          </div>
        </>
      )}
      <span className="sr-only">
        {label}: {item.name}
      </span>
    </div>
  );
}

/** Pointer-following holo sheen on the card's frame edge. */
function moveFoil(e: React.PointerEvent<HTMLDivElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 100;
  const y = ((e.clientY - r.top) / r.height) * 100;
  el.style.setProperty("--mx", `${x}%`);
  el.style.setProperty("--my", `${y}%`);
  el.style.setProperty("--angle", `${x * 3.6}`);
}

interface TasteCardProps {
  profile: Profile;
  accent?: string;
  /** "xs": a compact card for tight phone headers, with no domain icon row. */
  size?: "lg" | "md" | "sm" | "xs";
  className?: string;
  style?: React.CSSProperties;
  footer?: React.ReactNode;
  /** Lay out only the picks, with no empty slots: for finished example cards (4 picks become a 2 by 2 grid). */
  fit?: boolean;
  /** How many picks the person has in all (their persona can hold more than the card carries). */
  total?: number;
  /** The name's heading level: 2 where the card sits right under the page's h1 (/card), else 3. */
  headingLevel?: 2 | 3;
}

const SLOTS = 6;

export function TasteCard({
  profile,
  accent = "var(--film)",
  size = "lg",
  className,
  style,
  footer,
  fit = false,
  total,
  headingLevel = 3,
}: TasteCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const all = Math.max(total ?? 0, profile.items.length);
  // More picks than windows: the last window says "+N more" instead of a seventh poster.
  const more = all > SLOTS ? all - (SLOTS - 1) : 0;
  const items = profile.items.slice(0, more ? SLOTS - 1 : SLOTS);
  const fitCols = items.length <= 4 ? 2 : 3;
  const slots = fit && !more ? items.length : SLOTS;
  const domains = [...new Set(profile.items.map((i) => i.domain))];
  // As many icons as fit the row without clipping one; all of them are still read out.
  const shownDomains = domains.slice(0, size === "lg" ? 7 : size === "md" ? 6 : 4);

  return (
    <div
      onPointerMove={moveFoil}
      style={style}
      className={cn(
        "foil relative flex aspect-[5/7] flex-col rounded-card bg-ink text-paper shadow-card",
        size === "lg" && "w-full max-w-[20rem] p-4",
        size === "md" && "w-full max-w-[15rem] p-3",
        size === "sm" && "w-[9.5rem] p-2.5",
        size === "xs" && "w-[6.5rem] p-2",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading
            aria-label={`${profile.name}'s taste card`}
            className={cn(
              "font-display truncate font-black leading-none",
              size === "lg" && "text-title-md",
              size === "md" && "text-title-sm",
              size === "sm" && "text-body",
              size === "xs" && "text-label",
            )}
          >
            {profile.name}
          </Heading>
        </div>
        <span
          aria-hidden
          className={cn("shrink-0 rounded-full ring-2 ring-border-subtle-inverse", size === "xs" ? "mt-0.5 size-2.5" : "mt-1 size-3")}
          style={{ background: accent }}
        />
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1",
          size === "xs" ? "mt-2" : "mt-3",
          fit && fitCols === 2 ? "grid-cols-2" : "grid-cols-3",
          fit && items.length <= fitCols ? "grid-rows-1" : "grid-rows-2",
          size === "sm" || size === "xs" ? "gap-1" : "gap-2",
        )}
      >
        {Array.from({ length: slots }, (_, i) =>
          items[i] ? (
            <Poster key={items[i].id} item={items[i]} className="h-full" sizes={size === "lg" ? "110px" : "70px"} />
          ) : more && i === slots - 1 ? (
            <div
              key="more"
              className="@container flex flex-col items-center justify-center rounded-tile border-2 border-border-subtle-inverse text-center"
            >
              <span className={cn("font-display font-black leading-none", size === "lg" ? "text-title-sm" : size === "md" ? "text-body" : "text-label")}>
                +{more}
              </span>
              <span className="hidden text-caption font-bold text-paper-soft @[3.5rem]:block">more</span>
              <span className="sr-only @[3.5rem]:hidden"> more</span>
            </div>
          ) : (
            <div key={`empty-${i}`} className="rounded-tile border-2 border-dashed border-border-subtle-inverse" aria-hidden />
          ),
        )}
      </div>

      {/* Domain icons. Too small to fit on "xs", so there they are read out only. */}
      <div className={cn("mt-3 flex items-center justify-between gap-2", size === "sm" && "mt-2", size === "xs" && "sr-only")}>
        <div className={cn("flex min-w-0 overflow-hidden", size === "lg" ? "gap-1.5" : "gap-1")}>
          <span className="sr-only">Likes {domains.map((d) => DOMAIN_STYLE[d].label).join(", ")}</span>
          {shownDomains.map((d) => {
            const { Icon, color } = DOMAIN_STYLE[d];
            return (
              <span
                key={d}
                aria-hidden
                className={cn("grid shrink-0 place-items-center rounded-full", size === "lg" ? "size-7" : "size-6")}
                style={{ background: color }}
              >
                <Icon className={cn("text-ink", size === "lg" ? "size-3.5" : "size-3")} aria-hidden />
              </span>
            );
          })}
        </div>
        {footer}
      </div>
    </div>
  );
}
