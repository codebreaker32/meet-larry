"use client";

import * as React from "react";
import Image from "next/image";
import { Check, Flame, Loader2, MapPin, Mic, MicOff, RotateCcw, Search, X } from "lucide-react";
import { fieldStyles } from "@/components/ui/field";
import { useAgeBucket } from "@/lib/age";
import { MAX_ITEMS as CARD_ITEMS } from "@/lib/card-codec";
import { DOMAIN_STYLE, SPORT_FILTERS } from "@/lib/domain-style";
import { cleanName, NAME_MAX } from "@/lib/sanitize";
import { type Sport, SPORT_OF, STARTERS } from "@/lib/starters";
import { type Domain, type TasteItem, DOMAIN_KEYS } from "@/lib/types";
import { useApproxLocation } from "@/lib/location";
import { SPEECH_UNSUPPORTED, useSpeechToText } from "@/lib/use-speech";
import { cn } from "@/lib/utils";

const FULL_MESSAGE = "That's the most for here. Tap a picture above to take it off.";
const isSportsDomain = (d: Domain) => d === "sports_team" || d === "athlete";

/**
 * R2: the starters that are big in India, shown as their own "Big near you" row. The other starters
 * are the "Popular" row. Names, not ids, so the list reads plainly; every one is a real Qloo starter.
 */
const LOCAL_NAMES = new Set([
  "3 Idiots", "Arijit Singh", "Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bangalore",
  "India Men's National Cricket Team", "FC Goa", "Virat Kohli", "Harmanpreet Kaur", "MS Dhoni", "Smriti Mandhana",
  "Sunil Chhetri", "Neeraj Chopra", "On Purpose with Jay Shetty", "Khandaan - A Bollywood Podcast", "boAt", "Nykaa",
  "Royal Enfield", "Goa", "Jaipur", "Manali", "Rishikesh", "Shah Rukh Khan", "Deepika Padukone", "Priyanka Chopra",
  "Bhuvan Bam",
]);

/**
 * "Big near you" for films: what is popular around the person's stored coarse area, from Qloo
 * (GET /api/big-near-you, insights + signal.location). Only films are verified live, so the other
 * categories keep the static starter row. Never "rising" and never a city chart: just big near you.
 * Empty (and the static row stays) when there is no stored location or Qloo has nothing.
 */
function useBigNearYou(domain: Domain): TasteItem[] {
  const approx = useApproxLocation();
  const age = useAgeBucket();
  const lat = approx.location?.lat;
  const lon = approx.location?.lon;
  const [items, setItems] = React.useState<{ key: string; list: TasteItem[] }>({ key: "", list: [] });
  const key = domain === "movie" && lat !== undefined && lon !== undefined ? `${lat},${lon},${age ?? ""}` : "";
  React.useEffect(() => {
    if (!key || lat === undefined || lon === undefined) return;
    const ctrl = new AbortController();
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), ...(age ? { age } : {}) });
    fetch(`/api/big-near-you?${q}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { items?: TasteItem[] } | null) => {
        const list = (body?.items ?? []).filter((e): e is TasteItem => !!e?.id && !!e.name && e.domain === "movie");
        setItems({ key, list });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [key, lat, lon, age]);
  return key && items.key === key ? items.list : [];
}

/**
 * Picture-first taste picker over every Qloo category. There is no pick limit in the app (the QR
 * card carries the first 10); a caller may still pass `max` for a short quick card.
 */
export function PicturePicker({
  selected,
  onChange,
  max,
}: {
  selected: TasteItem[];
  onChange: (items: TasteItem[]) => void;
  max?: number;
}) {
  const [domain, setDomain] = React.useState<Domain>("movie");
  // The tapped category lights up at once; the new grid of pictures follows in a transition, so a
  // slow phone never holds the pressed state back while it renders the tiles (INP under 100 ms).
  const [shownDomain, setShownDomain] = React.useOptimistic(domain);
  const [sport, setSport] = React.useState<Sport | "all">("all");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<TasteItem[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  // Bumped by "Try again" after a failed search, so the same words are searched again.
  const [attempt, setAttempt] = React.useState(0);
  // Screen readers hear only what changed on purpose: picks, search results, errors.
  const [announcement, setAnnouncement] = React.useState("");
  const picksRef = React.useRef<HTMLUListElement>(null);
  const searchId = React.useId();
  const searchErrorId = React.useId();
  // Say a favourite instead of typing it (speech-to-text only; the words land in the search box).
  const speech = useSpeechToText((text) => setQuery(text.slice(0, 80)));

  React.useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&domain=${domain}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const body = await res.json();
        const found: TasteItem[] = body.results ?? [];
        setResults(found);
        setStatus("idle");
        setAnnouncement(found.length ? `${found.length} found.` : "Nothing found.");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStatus("error");
          setAnnouncement("Search isn't working right now.");
        }
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, domain, attempt]);

  const searching = query.trim().length > 0;
  const isPicked = (id: string) => selected.some((s) => s.id === id);
  const full = max !== undefined && selected.length >= max;
  const countWords = (n: number) => (max !== undefined ? `${n} of ${max} picked.` : `${n} picked.`);

  // Tile taps hand the new picks over in a transition, so two quick taps can land before the first
  // one renders: each tap builds on the picks handed over last, not on a stale render.
  const latest = React.useRef(selected);
  React.useLayoutEffect(() => {
    latest.current = selected;
  }, [selected]);
  const handOver = (next: TasteItem[]) => {
    latest.current = next;
    onChange(next);
  };

  const remove = (item: TasteItem) => {
    const next = latest.current.filter((s) => s.id !== item.id);
    handOver(next);
    setAnnouncement(`Took off ${item.name}. ${countWords(next.length)}`);
  };

  const toggle = (item: TasteItem) => {
    const now = latest.current;
    if (now.some((s) => s.id === item.id)) return remove(item);
    if (max !== undefined && now.length >= max) {
      // Not a dead end: take them to their picks so they can take one off.
      setAnnouncement(FULL_MESSAGE);
      picksRef.current?.querySelector("button")?.focus();
      return;
    }
    handOver([...now, item]);
    setAnnouncement(`Added ${item.name}. ${countWords(now.length + 1)}`);
  };

  const starters = isSportsDomain(domain) && sport !== "all" ? STARTERS[domain].filter((i) => SPORT_OF[i.id] === sport) : STARTERS[domain];
  // Films: Qloo's "Big near you" for the stored area when there is one; otherwise (and for every
  // other category) the static row of starters that are big in India.
  const bigNear = useBigNearYou(domain);
  const localStarters = starters.filter((i) => LOCAL_NAMES.has(i.name));
  const local = bigNear.length ? bigNear : localStarters;
  // Picture rows before search (R2): Popular, then Big near you. No "Rising" row: Qloo has no city trend list.
  const rows: { key: string; title: string; icon: React.ReactNode; items: TasteItem[] }[] = [
    { key: "popular", title: "Popular", icon: <Flame className="size-4" aria-hidden />, items: starters.filter((i) => !LOCAL_NAMES.has(i.name)) },
    { key: "local", title: "Big near you", icon: <MapPin className="size-4" aria-hidden />, items: local },
  ].filter((r) => r.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Picks: always visible, each one a button that takes it off the card. */}
      <section aria-labelledby="picks-title" className="flex flex-col gap-2">
        <h2 id="picks-title" className="font-bold">
          Your picks{" "}
          <span className="font-normal text-ink-soft">
            ({max !== undefined ? `${selected.length} of ${max}` : `${selected.length} picked`})
          </span>
        </h2>
        {selected.length === 0 ? (
          <p className="rounded-mini border-2 border-dashed border-border-subtle px-4 py-3 text-ink-soft">
            Nothing yet. Tap pictures below to add them.
          </p>
        ) : (
          <ul ref={picksRef} className="flex flex-wrap gap-2">
            {selected.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  aria-label={`Remove ${item.name}`}
                  className="press press-flat flex min-h-12 max-w-[16rem] items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 font-bold text-ink ring-2 ring-ink hover:bg-table"
                >
                  <Thumb item={item} />
                  <span className="truncate">{item.name}</span>
                  <X className="size-5 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {full && <p className="font-bold text-ink">{FULL_MESSAGE}</p>}
        {!full && selected.length > CARD_ITEMS && (
          <p className="text-ink-soft">Pick as many as you like. Your card shows the first {CARD_ITEMS}.</p>
        )}
      </section>

      {/* Wraps onto two rows on phones, so no category hides off-screen. */}
      <div role="group" aria-label="What kind of thing?" className="flex flex-wrap gap-2">
        {DOMAIN_KEYS.map((d) => {
          const { label, color, Icon } = DOMAIN_STYLE[d];
          const active = d === shownDomain;
          return (
            <button
              key={d}
              aria-pressed={active}
              type="button"
              onClick={() => {
                React.startTransition(() => {
                  setShownDomain(d);
                  setDomain(d);
                  setSport("all");
                });
              }}
              className={cn(
                "press press-soft flex min-h-12 shrink-0 items-center gap-2 rounded-full border-2 pl-2 pr-4 font-bold",
                active ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
              )}
            >
              <span className="grid size-6 place-items-center rounded-full" style={{ background: color }}>
                <Icon className="size-3.5 text-ink" aria-hidden />
              </span>
              {label}
            </button>
          );
        })}
      </div>

      {/* Sports and Players: filter by sport. Local icons; the tiles below are Qloo photos. */}
      {isSportsDomain(domain) && (
        <div role="group" aria-label="Which sport?" className="flex flex-wrap gap-2">
          {SPORT_FILTERS.map(({ key, label, Icon }) => {
            const active = key === sport;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setSport(key)}
                className={cn(
                  "press press-soft flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-label font-bold",
                  active ? "border-ink bg-ink text-paper" : "border-border-subtle bg-table text-ink hover:border-border-control",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {rows.map((r) => (
        <section key={r.key} aria-label={r.title} className="flex flex-col gap-2">
          {rows.length > 1 && (
            <h3 className="flex items-center gap-1.5 text-label font-bold text-ink">
              {r.icon}
              {r.title}
            </h3>
          )}
          <TileGrid items={r.items} isPicked={isPicked} full={full} onToggle={toggle} />
        </section>
      ))}

      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="font-bold">
          Can&apos;t see it? Search
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Type a name in ${DOMAIN_STYLE[domain].label}`}
              aria-describedby={speech.error ? searchErrorId : undefined}
              className={fieldStyles("md", "pl-12 pr-14 [&::-webkit-search-cancel-button]:hidden")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="press press-flat absolute right-1 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full text-ink-soft hover:bg-table"
              >
                <X className="size-5" aria-hidden />
              </button>
            )}
          </div>
          {speech.supported && (
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? "Stop listening" : `Say a name in ${DOMAIN_STYLE[domain].label}`}
              className={cn(
                "press press-hard grid size-14 shrink-0 place-items-center rounded-full border-2 border-ink",
                speech.listening ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-table",
              )}
            >
              {speech.listening ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
            </button>
          )}
        </div>
        {!speech.supported && <p className="text-caption text-ink-soft">{SPEECH_UNSUPPORTED}</p>}
        {speech.error && (
          <p id={searchErrorId} role="alert" className="font-bold text-danger">
            {speech.error}
          </p>
        )}
      </div>

      {searching && (
        <div className="flex flex-col gap-3">
          {status === "loading" && (
            <p className="flex items-center gap-2 text-ink-soft">
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> Looking…
            </p>
          )}
          {status === "error" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="font-bold text-danger">Search isn&apos;t working right now. The pictures above still work.</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="press press-flat flex min-h-12 items-center gap-1.5 rounded-full px-3 font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-table"
              >
                <RotateCcw className="size-4" aria-hidden /> Try again
              </button>
            </div>
          )}
          {status === "idle" && results.length === 0 && (
            <p className="text-ink-soft">Nothing found. Try a shorter name, or tap a picture above.</p>
          )}
          {status !== "error" && results.length > 0 && (
            <TileGrid items={results} isPicked={isPicked} full={full} onToggle={toggle} />
          )}
        </div>
      )}
    </div>
  );
}

/** A round thumbnail: Qloo art, or the domain icon on its colour (also when the art fails to load). */
export function Thumb({ item }: { item: TasteItem }) {
  const { color, Icon } = DOMAIN_STYLE[item.domain];
  const [failed, setFailed] = React.useState<string | null>(null);
  const image = item.image && item.image !== failed ? item.image : undefined;
  return (
    <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full" style={{ background: color }}>
      {image ? (
        <Image src={image} alt="" fill sizes="40px" className="object-cover" onError={() => setFailed(image)} />
      ) : (
        <Icon className="size-5 text-ink" aria-hidden />
      )}
    </span>
  );
}

function TileGrid({
  items,
  isPicked,
  full,
  onToggle,
}: {
  items: TasteItem[];
  isPicked: (id: string) => boolean;
  full: boolean;
  onToggle: (item: TasteItem) => void;
}) {
  // A stable handler, so a tap re-renders only the tiles whose picked state changed (Tile is memoised).
  const toggleRef = React.useRef(onToggle);
  React.useLayoutEffect(() => {
    toggleRef.current = onToggle;
  });
  const handle = React.useCallback((item: TasteItem) => toggleRef.current(item), []);
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Tile key={item.id} item={item} picked={isPicked(item.id)} full={full} onToggle={handle} />
      ))}
    </ul>
  );
}

const Tile = React.memo(function Tile({
  item,
  picked: committed,
  full,
  onToggle,
}: {
  item: TasteItem;
  picked: boolean;
  full: boolean;
  onToggle: (item: TasteItem) => void;
}) {
  const { color, Icon } = DOMAIN_STYLE[item.domain];
  // Art that fails to load (or that Qloo serves as its "oops" stand-in) falls back to the designed tile.
  const [failed, setFailed] = React.useState<string | null>(null);
  const image = item.image && item.image !== failed ? item.image : undefined;
  // The tick shows the moment the tile is tapped; the picks list and the card follow in a transition.
  // A full card adds nothing, so then there is nothing to show early.
  const [picked, setShownPicked] = React.useOptimistic(committed);
  const tap = () =>
    React.startTransition(() => {
      if (committed || !full) setShownPicked(!committed);
      onToggle(item);
    });
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        onClick={tap}
        className="group flex w-full flex-col gap-1.5 text-left"
      >
        <span
          className={cn(
            "relative block aspect-[3/4] w-full overflow-hidden rounded-tile border-(length:--border-frame) transition-transform duration-(--dur-quick) group-active:scale-95",
            picked ? "border-ink" : "border-transparent",
          )}
          style={{ background: color }}
        >
          {image ? (
            // When the card is full, only the picture fades; the name keeps full contrast.
            <Image
              src={image}
              alt=""
              fill
              sizes="(min-width: 640px) 160px, 33vw"
              className={cn("object-cover", !picked && full && "opacity-50 grayscale")}
              onError={() => setFailed(image)}
            />
          ) : (
            // No art in Qloo (every destination, checked live 30 Oct 2026): a dealt card on the
            // category colour, its icon on a paper coin and the name in the display face. Decorative:
            // the button's name is the label below.
            <span
              aria-hidden
              data-no-art
              className={cn(
                "absolute inset-1.5 flex flex-col items-center justify-between gap-1 rounded-inner border-2 border-ink/25 p-2 text-center",
                !picked && full && "opacity-50",
              )}
            >
              <span className="mt-2 grid size-10 place-items-center rounded-full bg-paper ring-2 ring-ink">
                <Icon className="size-5 text-ink" />
              </span>
              <span
                className={cn(
                  "line-clamp-3 max-w-full break-words font-display font-black uppercase leading-none tracking-tight text-ink",
                  // Long single words ("Barcelona") step down a size so they stay inside the frame.
                  Math.max(...item.name.split(/\s+/).map((w) => w.length)) > 7 ? "text-caption" : "text-body",
                )}
              >
                {item.name}
              </span>
            </span>
          )}
          {picked && (
            <span className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-ink text-paper ring-2 ring-paper">
              <Check className="size-5" aria-hidden />
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-label font-bold leading-snug text-ink">{item.name}</span>
      </button>
    </li>
  );
});

/** First-name input with an easy-read hint and, where the browser supports it, a mic for speech-to-text. */
export function NameField({
  id,
  value,
  onChange,
  hint,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (name: string) => void;
  hint: string;
  placeholder?: string;
}) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const hintId = React.useId();
  const errorId = React.useId();
  const speech = useSpeechToText((text) => onChange(cleanName(text)));

  return (
    <div className="flex max-w-sm flex-col gap-2">
      <label htmlFor={inputId} className="font-bold">
        Your first name
      </label>
      <p id={hintId} className="text-ink-soft">
        {hint}
      </p>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, NAME_MAX))}
          autoComplete="given-name"
          placeholder={placeholder}
          aria-describedby={speech.error ? `${hintId} ${errorId}` : hintId}
          className={fieldStyles("md", "text-lead")}
        />
        {speech.supported && (
          <button
            type="button"
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? "Stop listening" : "Say your name"}
            className={cn(
              "press press-hard grid size-14 shrink-0 place-items-center rounded-full border-2 border-ink",
              speech.listening ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-table",
            )}
          >
            {speech.listening ? <MicOff className="size-5" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
        )}
      </div>
      {speech.error && (
        <p id={errorId} role="alert" className="font-bold text-danger">
          {speech.error}
        </p>
      )}
    </div>
  );
}
