import Link from "next/link";
import { ArrowRight, Drama, ExternalLink, Footprints, MessageCircle, QrCode, ScanLine } from "lucide-react";
import { BridgeCard } from "@/components/bridge-card";
import { DealIn } from "@/components/deal-in";
import { LarryAvatar } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import { AppCard } from "@/components/app-card";
import { InstallApp } from "@/components/install-app";
import { HomeTop } from "@/components/next-move/home-top";
import { SiteHeader, SOLO_LABEL } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { APP_NAME } from "@/lib/brand";
import { GROUP_SCAN_HREF, GROUP_START_HREF, GROUP_WORD, PICK_A_PAL_HREF, TALK_TASTE_HREF } from "@/lib/next-move";
import { DEMO_PRIYA, DEMO_SAM } from "@/lib/demo";
import { SEAT_COLORS } from "@/lib/tokens";
import { suggestSteps } from "@/lib/suggest-steps";
import type { Bridge } from "@/lib/types";
import { cn } from "@/lib/utils";

// The example pair's real top bridge, copied verbatim from POST /api/common-ground (2026-10-30).
// Sam and Priya share no favourite; Qloo still finds common ground.
const HERO_BRIDGE: Bridge = {
  id: "7826DA9C-F761-42A1-A948-90A700082B80",
  name: "mxmtoon",
  domain: "artist",
  image: "https://images.qloo.com/i/7826DA9C-F761-42A1-A948-90A700082B80-420x-auto.jpg",
  affinity: 0.9295132045925383,
  fromA: ["Avatar: The Last Airbender"],
  fromB: ["Heartstopper"],
  scoreA: 0.17,
  scoreB: 0.18,
};

// Larry's real opening line for this pair and the card above, verbatim from POST /api/chat with
// ground { bridges: [HERO_BRIDGE] } (2026-10-30). The card, the line and the First Step below are
// all about the same item, so the hero tells one story.
const LARRY_LINE =
  "Hi Sam and Priya, I'm Larry, an AI pal. You might both like mxmtoon, because Sam likes Avatar and Priya likes Heartstopper. Priya, have you watched Avatar: The Last Airbender?";

// The First Step the app itself offers for this pair at the end of the session.
const HERO_STEP =
  suggestSteps({
    ground: { shared: [], bridges: [HERO_BRIDGE] },
    places: [],
    me: DEMO_SAM,
    other: DEMO_PRIYA,
    practice: false,
  }).find((s) => s.kind === "show") ?? null;

const STEPS = [
  { verb: "Pick", rest: "what you love", text: "Tap the films, music, games and teams you love. No typing needed." },
  { verb: "Find", rest: "what you share", text: `${APP_NAME} looks at what real fans love and tells you why you'd both like it.` },
  { verb: "Go out", rest: "together", text: "One real place, open now, with an easy thing to say when you get there." },
];

const inlineLink =
  "-my-3 inline-block py-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4";
const quietLink = "press press-flat -ml-1 flex min-h-12 items-center gap-2 rounded-full px-1 pr-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4 hover:bg-paper";

/** A marked zone on the play mat: a dashed slot with its name printed underneath. */
function Zone({
  label,
  className,
  boxClassName,
  children,
}: {
  label: string;
  className?: string;
  boxClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className={cn("relative rounded-card border-2 border-dashed border-border-subtle-inverse", boxClassName)}>{children}</div>
      <p className="mt-2 text-center text-label font-bold text-paper-soft">{label}</p>
    </div>
  );
}

/** The original hero, for visitors: the headline, the ways in and the play mat. */
function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-start gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:pt-4">
      {/* The headline sizes to its column (cqi), so each of its two lines always fits on one row. */}
      <div className="@container min-w-0 lg:pt-6">
        <h1 className="font-display text-display font-black">
          <span className="block whitespace-nowrap">Talk to someone,</span>
          <span className="block whitespace-nowrap">not something.</span>
        </h1>
        <p className="mt-6 max-w-[36ch] text-intro leading-relaxed text-ink-soft">
          Make your taste card, then start a {GROUP_WORD.toLowerCase()} with up to 4 friends by QR. {APP_NAME} finds
          something real to talk about, turns it into a plan, then steps back.
        </p>
        {/* Two strong ways in: your card, or a group. Scanning someone's QR is the quiet third. */}
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/create">
            Make my taste card <ArrowRight className="size-5" aria-hidden />
          </LinkButton>
          <LinkButton href={GROUP_START_HREF} variant="secondary">
            <QrCode className="size-5" aria-hidden /> Start a {GROUP_WORD.toLowerCase()}
          </LinkButton>
        </div>
        <p className="mt-3 text-ink-soft">
          A friend showing you their QR?{" "}
          <Link href={GROUP_SCAN_HREF} className={inlineLink}>
            <ScanLine className="mr-1 inline size-5 align-text-bottom" aria-hidden />
            Scan a {GROUP_WORD.toLowerCase()} QR
          </Link>
          <span className="sr-only">.</span>
        </p>
        {/* Only after a real win, never on a first visit: see AppCard. Its own row, apart from the links. */}
        <div className="mt-6 max-w-md empty:hidden">
          <AppCard placement="landing" />
          <InstallApp className="mt-3 -ml-4" />
        </div>

        <div className="mt-8 max-w-[44ch] border-t-2 border-line pt-5">
          <h2 className="font-bold text-ink">No one around yet?</h2>
          <ul className="mt-1 flex flex-wrap gap-x-2">
            <li>
              <Link href={TALK_TASTE_HREF} className={quietLink}>
                <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
              </Link>
            </li>
            <li>
              <Link href={PICK_A_PAL_HREF} className={quietLink}>
                <Drama className="size-5" aria-hidden /> Pick a pal
              </Link>
            </li>
          </ul>
          <p className="mt-2 text-ink-soft">Short chats that point you back to real people.</p>
        </div>
      </div>

      {/*
        The play mat: the same table the app deals on. Two cards, the common ground dealt
        between them, Larry's first line, and the First Step the session ends with.
      */}
      <figure className="relative mx-auto w-full max-w-[34rem]">
        {/* data-ui: a cropped fragment of the real app table, so its cards keep their shadows,
            foil edges and dashed card zones (taste-skill's mark for interface fragments). */}
        <div data-ui className="relative rounded-panel bg-mat p-3 shadow-card sm:p-4">
          <div className="relative grid grid-cols-2 gap-x-4 gap-y-4 rounded-bubble border border-border-subtle-inverse p-4 sm:gap-x-8 sm:p-5 lg:gap-x-12">
            <Zone label="You" className="aspect-[5/7.3]" boxClassName="h-full">
              <DealIn from="left" className="absolute inset-0">
                <div className="-rotate-[5deg]">
                  <TasteCard profile={DEMO_SAM} accent={SEAT_COLORS[0]} size="md" fit />
                </div>
              </DealIn>
            </Zone>
            <Zone label="Them" className="aspect-[5/7.3]" boxClassName="h-full">
              <DealIn from="right" delay={0.1} className="absolute inset-0">
                <div className="rotate-[4deg]">
                  <TasteCard profile={DEMO_PRIYA} accent={SEAT_COLORS[1]} size="md" fit />
                </div>
              </DealIn>
            </Zone>
            <Zone label="Common ground" className="col-span-2">
              <DealIn from="below" delay={0.45} className="p-2.5 sm:p-3">
                <BridgeCard
                  bridge={HERO_BRIDGE}
                  people={[
                    { id: "a", name: DEMO_SAM.name, color: SEAT_COLORS[0] },
                    { id: "b", name: DEMO_PRIYA.name, color: SEAT_COLORS[1] },
                  ]}
                  className="mx-auto max-w-[24rem] -rotate-1 shadow-deal"
                />
              </DealIn>
            </Zone>

            {/* Larry's first line: an ink bubble, always labelled as an AI. */}
            <DealIn from="below" delay={0.7} className="col-span-2">
              <p className="mb-1.5 flex items-center gap-2.5 text-label font-bold text-paper-soft">
                {/* Larry's mascot, a small card of its own on the mat. */}
                <LarryAvatar size="lg" variant="full" className="-rotate-3 rounded-mini bg-table ring-(length:--border-frame) ring-paper shadow-mini" />
                {APP_NAME} (AI pal)
              </p>
              <p className="rounded-bubble bg-ink px-4 py-2.5 text-body leading-snug text-paper ring-2 ring-border-subtle-inverse">
                {LARRY_LINE}
              </p>
            </DealIn>

            {/* Where the session ends: one small real thing to do, saved as a First Step. */}
            {HERO_STEP && (
              <DealIn from="below" delay={0.9} className="col-span-2">
                <p className="flex min-h-12 items-center gap-3 rounded-full bg-paper py-2 pl-2 pr-4 text-ink ring-(length:--border-frame) ring-cat-film">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-cat-film">
                    <Footprints className="size-5 text-ink" aria-hidden />
                  </span>
                  <span className="min-w-0 text-label leading-snug">
                    <span className="font-bold">First Step:</span> {HERO_STEP.text}
                  </span>
                </p>
              </DealIn>
            )}
          </div>
        </div>
        <figcaption className="mt-3 text-center text-label text-ink-soft">
          Example: Sam and Priya are made up and share no favourite. The match, {APP_NAME}&apos;s line and the First
          Step are real app results.
        </figcaption>
      </figure>
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        {/*
          Visitors get the hero below. A signed-in person gets a hello, the normal buttons and the
          "Larry's next move" pill, with the move itself as a popup at most once a day (client-only).
        */}
        <HomeTop hero={<Hero />} />

        <section className="bg-ink text-paper">
          <ol className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.verb} className="max-w-sm">
                <p
                  className="font-display text-step font-black leading-none"
                  style={{ color: ["var(--cat-tv)", "var(--cat-music)", "var(--cat-film)"][i] }}
                >
                  {s.verb}.
                </p>
                <p className="mt-2 font-display text-title-sm font-black text-paper">{s.rest}</p>
                <p className="mt-3 text-lead leading-relaxed text-paper-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-20">
          <h2 className="font-display text-title-page font-black leading-title">Built to be needed less.</h2>
          {/* Easy read: one short promise per line, not one long paragraph. */}
          <ul className="flex max-w-measure flex-col gap-3 text-lead leading-relaxed text-ink-soft">
            <li>Every idea comes from what real people love, and {APP_NAME} says why.</li>
            <li>Nobody can see where you are or where you&apos;ve been.</li>
            <li>
              A {GROUP_WORD.toLowerCase()} starts with a QR you show in person. Leave, unfriend or block in one tap.
            </li>
            <li>
              A new person can only say hello if you are both 18 or over, at the same public place, and you both wave.
            </li>
            <li className="font-bold text-ink">
              When you start talking, {APP_NAME} goes quiet. Success is a plan you actually do.
            </li>
          </ul>
        </section>
      </main>

      <footer className="bg-paper px-5 py-6 text-ink-soft sm:px-8">
        <p className="mx-auto max-w-6xl">
          {APP_NAME} is an AI and will always say so. It isn&apos;t therapy. If you&apos;re
          struggling, please talk to someone you trust, or{" "}
          <a
            href="https://findahelpline.com"
            target="_blank"
            rel="noopener noreferrer"
            className="-my-3 inline-flex min-h-12 items-center gap-1 py-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4"
          >
            find a helpline in your country
            <ExternalLink className="size-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
