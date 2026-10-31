"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { Camera, CameraOff, Link2, Pencil, Users } from "lucide-react";
import { LarryMoment } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import { SiteHeader } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { Button, Field } from "@/components/ui";
import {
  GROUP_WORD_LOWER,
  type GroupPreviewResponse,
  joinGroup,
  joinNames,
  previewGroup,
  tokenFromInput,
} from "@/components/group/group-api";
import { GroupGate } from "@/components/group/group-gate";
import { joinTokenFromHash } from "@/lib/groups/shared";
import { APP_NAME } from "@/lib/brand";
import { personaToProfile, usePersona } from "@/lib/persona";

// Join a group by its QR (D26). Three ways in: the phone's own camera app opens /scan#t=<token>; the
// in-page camera (where the browser can read QR codes); or a pasted link. The token lives in the URL
// fragment, which never reaches a server log, and it is moved to this tab's sessionStorage at once
// (and wiped from the address bar), so signing in first doesn't lose it.

const PENDING_KEY = "larry.group.scan";

function takeHashToken(): string | null {
  const token = joinTokenFromHash(window.location.hash);
  if (token) {
    try {
      sessionStorage.setItem(PENDING_KEY, token);
    } catch {
      /* private mode: it still works for this page view */
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return token;
}

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing kept */
  }
}

export default function ScanPage() {
  // Read the fragment before anything else (the sign-in gate may redirect away from this page).
  const [token, setToken] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL fragment once, on the client
    setToken(takeHashToken() ?? readPending());
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 sm:px-8">
        <Suspense fallback={null}>
          {token !== undefined && (
            <GroupGate>
              {() =>
                token ? (
                  <JoinFromToken
                    token={token}
                    onReset={() => {
                      clearPending();
                      setToken(null);
                    }}
                  />
                ) : (
                  <ScanOrPaste onToken={setToken} />
                )
              }
            </GroupGate>
          )}
        </Suspense>
      </main>
    </div>
  );
}

function JoinFromToken({ token, onReset }: { token: string; onReset: () => void }) {
  const router = useRouter();
  const persona = usePersona();
  const profile = React.useMemo(() => (persona && persona.likes.length ? personaToProfile(persona) : persona === undefined ? undefined : null), [persona]);
  const [preview, setPreview] = React.useState<GroupPreviewResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    previewGroup(token, ctrl.signal)
      .then(setPreview)
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      });
    return () => ctrl.abort();
  }, [token]);

  const join = async () => {
    if (!profile || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await joinGroup(token, profile);
      clearPending();
      router.replace(`/group/${encodeURIComponent(out.group.id)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (error && !preview) {
    return (
      <section className="mt-8 flex flex-col items-start gap-4">
        <LarryMoment kind="empty" layout="row" title={error} headingLevel={2} />
        <Button variant="secondary" onClick={onReset}>
          Scan another QR
        </Button>
      </section>
    );
  }
  if (!preview || profile === undefined) return <LarryMoment kind="thinking" title="Checking the QR" className="mx-auto mt-16" />;

  const names = joinNames(preview.names);
  return (
    <section aria-labelledby="join-title" className="mt-4 flex flex-col gap-5">
      <h1 id="join-title" className="font-display text-title-page font-black leading-title">
        Join {names ? `${names}'s` : "this"} {GROUP_WORD_LOWER}?
      </h1>
      <p className="max-w-measure text-lead text-ink-soft">
        {preview.openSeats === 1 ? "One seat left. " : `${preview.openSeats} seats left. `}
        Joining makes you friends with everyone in it. {APP_NAME} opens the chat with what you all like.
      </p>
      {profile === null ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border-2 border-ink bg-paper p-5">
          <h2 className="font-display text-title-sm font-black">First, your taste card</h2>
          <p className="text-ink-soft">It takes about a minute. This QR waits for you in this tab.</p>
          <LinkButton href="/create">
            <Pencil className="size-5" aria-hidden /> Make my taste card
          </LinkButton>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-panel bg-paper p-4 ring-2 ring-line">
            <TasteCard profile={profile} size="sm" className="shrink-0 -rotate-2" />
            <p className="min-w-0 flex-1">You join with your card, {profile.name}. They see your name and picks, never your phone number.</p>
          </div>
          {error && (
            <p role="alert" className="font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button icon={<Users />} loading={busy} onClick={join}>
              Join the {GROUP_WORD_LOWER}
            </Button>
            <Button variant="quiet" onClick={onReset}>
              Not now
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Minimal shape of the browser's BarcodeDetector (Chrome on Android and desktop). */
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

function ScanOrPaste({ onToken }: { onToken: (t: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = React.useState<"off" | "starting" | "on" | "unavailable">("off");
  const [link, setLink] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  React.useEffect(() => stop, [stop]);

  const startCamera = async () => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setCamera("on");
      const detector = new Ctor({ formats: ["qr_code"] });
      const loop = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const found = codes.map((c) => tokenFromInput(c.rawValue)).find((t): t is string => !!t);
          if (found) {
            stop();
            onToken(found);
            return;
          }
        } catch {
          /* a frame that couldn't be read: try the next one */
        }
        setTimeout(loop, 300);
      };
      void loop();
    } catch {
      stop();
      setCamera("unavailable");
    }
  };

  const useLink = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tokenFromInput(link);
    if (!t) {
      setLinkError("Paste the whole link they shared. It starts with https.");
      return;
    }
    setLinkError(null);
    onToken(t);
  };

  return (
    <>
      <h1 className="font-display text-title-page font-black leading-title">Scan a {GROUP_WORD_LOWER} QR</h1>
      <p className="mt-3 max-w-measure text-lead text-ink-soft">
        The easiest way: open your phone&apos;s camera app, point it at their QR and tap the link.
      </p>

      <section aria-labelledby="cam-title" className="mt-8 flex flex-col gap-3 rounded-panel border-2 border-ink bg-paper p-5">
        <h2 id="cam-title" className="font-display text-title-sm font-black">
          Or scan here
        </h2>
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera view"
          className={camera === "on" || camera === "starting" ? "aspect-square w-full max-w-sm self-center rounded-mini bg-ink object-cover" : "hidden"}
        />
        {camera === "unavailable" ? (
          <p role="status" className="flex items-start gap-2 text-ink">
            <CameraOff className="mt-0.5 size-5 shrink-0" aria-hidden />
            This browser can&apos;t read QR codes here. Your camera app can, or paste the link below.
          </p>
        ) : camera === "on" ? (
          <p role="status" className="font-bold">
            Point it at the QR. It joins as soon as it sees it.
          </p>
        ) : (
          <Button variant="secondary" icon={<Camera />} loading={camera === "starting"} onClick={startCamera} className="self-start">
            Use the camera
          </Button>
        )}
      </section>

      <form onSubmit={useLink} className="mt-6 flex flex-col gap-3 rounded-panel bg-paper p-5 ring-2 ring-line" noValidate>
        <Field
          label="Got a link instead?"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste the link here"
          inputMode="url"
          autoComplete="off"
          error={linkError ?? undefined}
        />
        <Button type="submit" variant="secondary" icon={<Link2 />} className="self-start">
          Open the link
        </Button>
      </form>
    </>
  );
}
