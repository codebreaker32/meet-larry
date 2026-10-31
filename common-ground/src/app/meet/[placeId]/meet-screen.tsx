"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Footprints, Hand, HelpCircle, Loader2, LocateFixed, LogIn, MapPin, MessageCircle, Power, ShieldCheck, Timer } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { arrive } from "@/components/checkin/api";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { LarryAvatar, LarryMoment } from "@/components/larry-avatar";
import { saveCredentials } from "@/components/meet-chat/room-api";
import { BlockReport } from "@/components/safety/block-report";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { canOpenToMeet, useAgeBucket } from "@/lib/age";
import { APP_NAME } from "@/lib/brand";
import { saveOpenVisit, useOpenVisit } from "@/lib/checkins";
import { MEET_POLL_MS } from "@/lib/meet/config";
import { closeMeet, closeOnLeave, currentWhere, getNearby, getVenue, MeetApiError, type NearbyGroup, openMeet, waveAt } from "@/lib/meet/client";
import { usePersona } from "@/lib/persona";
import { useStored } from "@/lib/storage";
import { cn } from "@/lib/utils";

// /meet/[placeId]: for signed-in members aged 18+ only. Check in here (a real, verified check-in),
// switch on Open to meet (with the exact entry others would see and what they never see), then see
// anonymous counts of people here who share something with you, each with Larry's witty line about
// the shared thing ("A fellow Ghibli soul is in here somewhere"), and wave at a group. A mutual wave
// opens a chat with Larry. The phone's location is sent with each check to show it is at the venue,
// and never stored. Visible only while on: it switches off after 3 hours, on "Switch off", on
// leaving the venue, or when this page closes.

/** "Plain words" (R6): Larry's plain line instead of the witty one. The switch lives in /me settings. */
export const PLAIN_WORDS_KEY = "larry.plainWords";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

interface Session {
  id: string;
  expiresAt: number;
}

export const meetChatHref = (code: string) => `/meet/chat/${code}`;

export function MeetScreen({ placeId }: { placeId: string }) {
  const persona = usePersona();
  const auth = useAuth();
  const age = useAgeBucket();
  const [venue, setVenue] = React.useState<{ name: string } | null>(null);
  const [venueError, setVenueError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    getVenue(placeId, ctrl.signal)
      .then((v) => setVenue(v.venue))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setVenueError((err as Error).message);
      });
    return () => ctrl.abort();
  }, [placeId]);

  let body: React.ReactNode;
  const signedIn = auth.status === "signed-in";
  if (venueError) body = <Problem title="Open to meet isn't available here" text={venueError} />;
  else if (!venue || persona === undefined || auth.status === "loading" || age === undefined) body = <Loading />;
  else if (!signedIn && age && !canOpenToMeet(age))
    // Under 18 (device-only Larry): warm, honest, and a real next step.
    body = (
      <Problem
        title="Open to meet opens up at 18"
        text={`Until then, ${APP_NAME} can still find you places, plans and check-ins here at ${venue.name}.`}
        action={
          <LinkButton href="/steps">
            <Footprints className="size-5" aria-hidden /> See your next step
          </LinkButton>
        }
      />
    );
  else if (!signedIn)
    body = (
      <Problem
        title="Open to meet is for members 18+"
        text={`Sign in, and you're in. Only your shared tastes show up at ${venue.name}, never your name, photo or where you've been.`}
        action={
          <LinkButton href={`/signin?next=${encodeURIComponent(`/meet/${encodeURIComponent(placeId)}`)}`}>
            <LogIn className="size-5" aria-hidden /> Sign in
          </LinkButton>
        }
      />
    );
  else if (!persona || persona.likes.length === 0)
    body = (
      <Problem
        title="Make your taste card first"
        text={`${APP_NAME} needs to know a few things you like, so it can find people here who like them too.`}
        action={<LinkButton href="/create">Make my taste card</LinkButton>}
      />
    );
  else body = <MeetFlow placeId={placeId} venueName={venue.name} persona={{ name: persona.name, likes: persona.likes }} />;

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 pb-16 pt-2">{body}</main>
    </div>
  );
}

function Loading() {
  return <LarryMoment kind="thinking" layout="row" className="pt-6" />;
}

function Problem({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-4 pt-6">
      <h1 className="font-display text-title-page font-black leading-title">{title}</h1>
      <p className="text-lead text-ink-soft">{text}</p>
      {action}
    </section>
  );
}

function MeetFlow({ placeId, venueName, persona }: { placeId: string; venueName: string; persona: { name: string; likes: import("@/lib/types").TasteItem[] } }) {
  const router = useRouter();
  // Open to meet needs a verified check-in here (Arrive within 150 m, PRODUCT.md). An open visit
  // here counts; otherwise "I'm here" checks in now. The server checks the visit token and a fresh
  // fix against the venue before anything switches on.
  const visit = useOpenVisit();
  const here = visit?.placeId === placeId ? visit : null;
  const [checkingIn, setCheckingIn] = React.useState(false);
  const [adult, setAdult] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);
  const [opening, setOpening] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nearby, setNearby] = React.useState<NearbyGroup[] | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [waving, setWaving] = React.useState<string | null>(null);

  // A real check-in: the same Arrive as the check-in sheet. Leave later on First Steps to count it.
  const imHere = async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    setError(null);
    const r = await arrive(placeId);
    setCheckingIn(false);
    if (r.ok) {
      saveOpenVisit({ placeId, placeName: r.placeName ?? venueName, visitToken: r.visitToken, dwellMs: r.dwellMs, arrivedAt: Date.now() });
      return;
    }
    setError(
      r.reason === "no-permission"
        ? "Larry needs your location to check you in. Allow location for this page, then try again."
        : (r.line ?? "Hmm, that didn't go through. Try again in a moment?"),
    );
  };

  const switchOn = async () => {
    if (opening) return;
    if (!adult) {
      setError("Tick the box to say you are 18 or over.");
      return;
    }
    if (!here) return;
    setOpening(true);
    setError(null);
    setNotice(null);
    try {
      // A fresh fix: the server checks it against the venue and throws it away.
      const where = await currentWhere(0);
      const s = await openMeet(placeId, { name: persona.name, likes: persona.likes }, where, here.visitToken);
      setSession({ id: s.sessionId, expiresAt: s.expiresAt });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const switchOff = React.useCallback(
    async (why?: string) => {
      const s = session;
      setSession(null);
      setNearby(null);
      setNotice(why ?? "Open to meet is off. Nobody here can see you now.");
      if (s) await closeMeet(placeId, s.id).catch(() => {});
    },
    [session, placeId],
  );

  // While on: ask who is here every 15 s, switch off at the 3-hour mark, and on leaving the page.
  React.useEffect(() => {
    if (!session) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const where = await currentWhere();
        if (ctrl.signal.aborted) return;
        const r = await getNearby(placeId, session.id, where, ctrl.signal);
        setNearby(r.groups);
        setError(null);
        for (const m of r.matches) saveCredentials(m.credentials);
        setChats(r.matches.map((m) => m.roomCode));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (err instanceof MeetApiError && (err.status === 410 || err.status === 401)) {
          setSession(null);
          setNearby(null);
          // The server's own words when it saw this phone leave the venue.
          setNotice(err.status === 410 && /left/.test(err.message) ? err.message : "Open to meet switched itself off. Switch it on again if you are still here.");
          return;
        }
        // No fix right now (indoors, say): say so, and try again on the next check.
        if (err instanceof MeetApiError && (err.status === 0 || err.status === 403 || err.status === 428)) setError(err.message);
      }
      timer = setTimeout(poll, MEET_POLL_MS);
    };
    void poll();
    const off = setTimeout(() => {
      setSession(null);
      setNearby(null);
      setNotice("Three hours are up, so Open to meet is off now.");
    }, Math.max(0, session.expiresAt - Date.now()));
    const onLeave = () => closeOnLeave(placeId, session.id);
    window.addEventListener("pagehide", onLeave);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
      clearTimeout(off);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [session, placeId]);

  // Leaving for another page in the app also switches off (except into the chat a wave opened).
  const sessionRef = React.useRef(session);
  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const keepOn = React.useRef(false);
  React.useEffect(
    () => () => {
      if (sessionRef.current && !keepOn.current) closeOnLeave(placeId, sessionRef.current.id);
    },
    [placeId],
  );

  const wave = async (groupId: string) => {
    if (!session || waving) return;
    setWaving(groupId);
    setError(null);
    try {
      const r = await waveAt(placeId, session.id, groupId, await currentWhere());
      if (r.mutual) {
        saveCredentials(r.credentials);
        keepOn.current = true;
        router.push(meetChatHref(r.roomCode));
        return;
      }
      setNearby((list) => list?.map((e) => (e.groupId === groupId ? { ...e, waved: true } : e)) ?? list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWaving(null);
    }
  };

  return (
    <>
      <section className="flex flex-col gap-3 pt-4">
        <h1 className="font-display text-title-page font-black leading-title">Open to meet</h1>
        <p className="flex items-center gap-2 text-lead">
          <MapPin className="size-5 shrink-0" aria-hidden /> {venueName}
        </p>
      </section>

      {!here ? (
        <section className="flex flex-col gap-4 rounded-panel border-2 border-ink bg-paper p-5" aria-labelledby="here-title">
          <h2 id="here-title" className="font-display text-title-sm font-black">
            Are you at {venueName} now?
          </h2>
          <p className="text-body">
            Check in first. Your phone shows {APP_NAME} you are here, then the location is thrown away. Stay 20 minutes or more and the visit counts too.
          </p>
          <Button onClick={imHere} loading={checkingIn} icon={<Check />}>
            I&apos;m here
          </Button>
        </section>
      ) : !session ? (
        <SwitchOn
          venueName={venueName}
          example={persona.likes[0]?.name ?? "Spirited Away"}
          adult={adult}
          setAdult={setAdult}
          opening={opening}
          onSwitchOn={switchOn}
        />
      ) : (
        <OnPanel
          sessionId={session.id}
          venueName={venueName}
          expiresAt={session.expiresAt}
          nearby={nearby}
          chats={chats}
          waving={waving}
          onWave={wave}
          onHidden={(groupId) => setNearby((list) => list?.filter((e) => e.groupId !== groupId) ?? list)}
          onOpenChat={() => (keepOn.current = true)}
          onSwitchOff={() => switchOff()}
        />
      )}

      {notice && (
        <p role="status" className="rounded-tile bg-paper p-3 text-body">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function SwitchOn({
  venueName,
  example,
  adult,
  setAdult,
  opening,
  onSwitchOn,
}: {
  venueName: string;
  /** One of this person's own picks, for the preview of what others see. */
  example: string;
  adult: boolean;
  setAdult: (v: boolean) => void;
  opening: boolean;
  onSwitchOn: () => void;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="switch-title">
      <div className="flex items-start gap-3">
        <LarryAvatar size="lg" />
        <p className="rounded-bubble bg-ink px-4 py-3 text-body text-paper">
          I can tell you if someone here likes the same things as you. Nobody sees who you are unless you both wave.
        </p>
      </div>

      {/* Show, don't list (persona walkthrough, Rohan and Anjali; user-research R11): the exact kind
          of entry others see, built from this person's own pick, beside what is never shown. */}
      <div className="flex flex-col gap-4 rounded-panel border-2 border-ink bg-paper p-5">
        <h2 id="switch-title" className="font-display text-title-sm font-black">
          Before you switch it on
        </h2>
        <p className="text-body">Only your shared tastes show up, never your name, photo or where you&apos;ve been. You decide if anyone gets more.</p>
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-bold">
            <Eye className="size-5 shrink-0" aria-hidden /> This is all people here see
          </h3>
          <figure className="flex flex-col gap-1 rounded-mini border-2 border-ink bg-paper p-4 shadow-mini">
            <figcaption className="text-caption font-bold text-ink-soft">Example</figcaption>
            <p className="text-body font-bold">A fellow {example} fan is in here somewhere.</p>
            <p className="text-label text-ink-soft">Someone here likes {example} too.</p>
          </figure>
          <WhichOne />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-bold">
            <EyeOff className="size-5 shrink-0" aria-hidden /> Nobody sees
          </h3>
          <ul className="flex flex-wrap gap-2">
            {NEVER_SHOWN.map((thing) => (
              // Not struck through: crossed-out words are hard to read (easy-read), the heading says it.
              <li key={thing} className="flex items-center gap-1.5 rounded-full border-2 border-line bg-table px-3 py-1 text-label font-bold text-ink">
                <EyeOff className="size-4 shrink-0 text-ink-soft" aria-hidden />
                {thing}
              </li>
            ))}
          </ul>
        </div>
        <Point Icon={LocateFixed} title="Your location">
          Your phone shows {APP_NAME} you are at {venueName}. It is checked, then thrown away. Nobody else sees it. If you leave, Open to meet switches off.
        </Point>
        <Point Icon={Hand} title="If you both wave">
          {APP_NAME} opens a chat for you two. {APP_NAME} is an AI. It stays in the chat to help keep it safe. If you meet, meet here at {venueName}.
        </Point>
        <Point Icon={Timer} title="It switches off by itself">
          After 3 hours, when you leave, or when you close this page.
        </Point>
        <Point Icon={ShieldCheck} title={`${APP_NAME} looks out for you`}>
          If someone asks for money, your home address, or to go somewhere private, {APP_NAME} steps in. If anything feels off, tap
          Block. They vanish from your {APP_NAME} for good, no questions asked.
        </Point>
      </div>

      <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-tile border-2 border-ink bg-paper px-4 py-3 text-body font-bold">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-6 shrink-0 accent-[var(--ink)]" />
        I am 18 or over.
      </label>
      <p className="-mt-3 text-label text-ink-soft">Open to meet is for 18+. Quick check, and you&apos;re in.</p>

      <div className="flex flex-wrap items-center gap-3">
        {/* Before the tick it looks unavailable but still answers, pointing at the box. */}
        <Button
          onClick={onSwitchOn}
          loading={opening}
          icon={<Power />}
          aria-disabled={opening || !adult || undefined}
          aria-describedby={!adult ? "meet-tick-first" : undefined}
        >
          Switch on Open to meet
        </Button>
        {!adult && (
          <span id="meet-tick-first" className="text-label text-ink">
            Tick the box first.
          </span>
        )}
      </div>
    </section>
  );
}

/** One comprehension tap (R11): people learn by asking the question a stranger would. */
function WhichOne() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="which-one-answer"
        onClick={() => setOpen((o) => !o)}
        className="press press-flat inline-flex min-h-12 items-center gap-2 rounded-full px-1 text-label font-bold text-ink underline decoration-2 underline-offset-4"
      >
        <HelpCircle className="size-5" aria-hidden /> Could they tell which one is me?
      </button>
      <p id="which-one-answer" hidden={!open} className="text-label text-ink">
        No. It&apos;s one shared thing and a count, never a person. Your name stays hidden unless you both wave.
      </p>
    </div>
  );
}

/** What strangers never see, shown crossed out next to the preview. */
const NEVER_SHOWN = ["Your name", "Your photo", "Your card", "Where you go", "When you come here"];

function Point({ Icon, title, children }: { Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-1 size-5 shrink-0" aria-hidden />
      <p className="text-body">
        <strong>{title}.</strong> {children}
      </p>
    </div>
  );
}

function OnPanel({
  sessionId,
  venueName,
  expiresAt,
  nearby,
  chats,
  waving,
  onWave,
  onHidden,
  onOpenChat,
  onSwitchOff,
}: {
  sessionId: string;
  venueName: string;
  expiresAt: number;
  nearby: NearbyGroup[] | null;
  chats: string[];
  waving: string | null;
  onWave: (groupId: string) => void;
  onHidden: (groupId: string) => void;
  onOpenChat: () => void;
  onSwitchOff: () => void;
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="on-title">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-ink p-4 text-paper">
        <p id="on-title" className="text-body">
          <strong>Open to meet is on</strong>
          <span className="block text-paper-soft">It switches off at {timeFmt.format(expiresAt)}.</span>
        </p>
        <button type="button" onClick={onSwitchOff} className={cn(buttonStyles.secondary, "min-h-12")}>
          <Power className="size-5" aria-hidden /> Switch off
        </button>
      </div>

      {chats.length > 0 && (
        <div className="flex flex-col gap-2 rounded-panel border-2 border-ink bg-paper p-4">
          <p className="text-body font-bold">You both waved. Your chat is open.</p>
          {chats.map((code) => (
            <Link key={code} href={meetChatHref(code)} onClick={onOpenChat} className={buttonStyles.primary}>
              <MessageCircle className="size-5" aria-hidden /> Open the chat
            </Link>
          ))}
        </div>
      )}

      <h2 className="font-display text-title-sm font-black">People here who share your taste</h2>
      {nearby === null ? (
        <Loading />
      ) : nearby.length === 0 ? (
        // Never a dead end (persona walkthrough, Diego; user-research R12): say it is normal and offer the next real thing.
        <div className="rounded-card border-2 border-dashed border-line p-5">
          <LarryMoment kind="empty" layout="row" title={`Nobody here shares your taste yet. That's normal, and ${venueName} is still a good call.`}>
            <p className="text-body text-ink">
              {APP_NAME} keeps checking while it&apos;s on, so put your phone away and enjoy it. If someone turns up, they&apos;ll be here when you look again.
            </p>
            <LinkButton href="/steps" variant="secondary" className="min-h-12 self-start px-4">
              <Footprints className="size-5" aria-hidden /> See your next step
            </LinkButton>
          </LarryMoment>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {nearby.map((e) => (
            <li key={e.groupId} className="flex flex-col gap-3 rounded-mini border-2 border-ink bg-paper p-4 shadow-mini">
              <GroupLines group={e} />
              <div className="flex flex-wrap items-center gap-2">
                {e.waved ? (
                  <span className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border-2 border-line bg-table px-4 text-body font-bold text-ink-soft">
                    <Check className="size-5" aria-hidden /> You waved
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onWave(e.groupId)}
                    aria-disabled={waving !== null || undefined}
                    className={cn(buttonStyles.primary, "min-h-12 flex-1")}
                  >
                    {waving === e.groupId ? <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> : <Hand className="size-5" aria-hidden />}
                    Wave
                  </button>
                )}
                <BlockReport
                  target={{ sessionId, groupId: e.groupId }}
                  who={e.count === 1 ? "this person" : "the people in this group"}
                  plural={e.count > 1}
                  onDone={() => onHidden(e.groupId)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-body text-ink-soft">
        A wave goes to everyone in that group. Nobody finds out you waved unless they wave back. Then {APP_NAME} opens a chat for you two, here at {venueName}.
      </p>
    </section>
  );
}

/** Larry's line about the shared thing (or its plain twin with "Plain words" on), then the count line. */
function GroupLines({ group }: { group: NearbyGroup }) {
  const plain = useStored<boolean>(PLAIN_WORDS_KEY, false);
  const larry = group.witty ? (plain ? group.witty.plain : group.witty.line) : null;
  return (
    <div className="flex flex-col gap-1">
      {larry && larry !== group.line && <p className="text-body font-bold">{larry}</p>}
      <p className={larry ? "text-label text-ink-soft" : "text-body"}>{group.line}</p>
    </div>
  );
}
