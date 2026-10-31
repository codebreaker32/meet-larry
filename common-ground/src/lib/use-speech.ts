"use client";

import { STORAGE_KEYS } from "@/lib/types/storage-keys";
import { useCallback, useEffect, useRef, useState } from "react";
import { readStored, useBrowserSupport, writeStored } from "./storage";

// Speech-to-text only, using the browser's built-in recognition (Chrome, Edge, Safari).
// Nothing is spoken back; the live words land in the text box for the person to check.
// - It keeps listening through every pause (a stammer block, a breath, a long think) until the person
//   taps stop. There is no time limit and no countdown.
// - It never sends anything by itself (persona walkthrough, Meera; user-research R4).
// - English (India) or Hindi, remembered on this phone. Switching while listening carries on in the
//   new language, keeping the words already heard.
// - Honest about where the audio goes: the browser's own service does the work (SPEECH_HONESTY).

export type SpeechLang = "en-IN" | "hi-IN";

export const SPEECH_LANGS: { value: SpeechLang; label: string }[] = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
];

/** The one-line honesty note shown with the mic. */
export const SPEECH_HONESTY = "Your browser turns speech into text (Google in Chrome, Apple in Safari).";
/** Shown instead of hiding the mic silently when the browser has no speech-to-text. */
export const SPEECH_UNSUPPORTED = "Open in Chrome or Safari to use the mic.";

/** Device-only, never synced. */
const LANG_KEY = STORAGE_KEYS.speechLang;

/** Pauses the browser reports as "no-speech" or "aborted" are not errors to show. */
const QUIET_ERRORS = new Set(["no-speech", "aborted"]);
/** A browser that ends recognition this often in one second is stuck: stop instead of spinning. */
const RESTART_BURST = 5;

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const isLang = (v: unknown): v is SpeechLang => SPEECH_LANGS.some((l) => l.value === v);

/** Joins the words heard so far with the next chunk, with one space between. */
export function joinHeard(before: string, next: string): string {
  const a = before.trim();
  const b = next.trim();
  return a && b ? `${a} ${b}` : a || b;
}

/**
 * `onText` gets the whole text heard in this listening session (final words plus the live, still
 * changing ones) every time it changes. `start(prefix)` keeps text already in the box in front.
 */
export function useSpeechToText(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLangState] = useState<SpeechLang>(() => {
    const v = readStored<unknown>(LANG_KEY, null);
    return isLang(v) ? v : "en-IN";
  });
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });
  const supported = useBrowserSupport(() => !!getCtor());

  // Set when the person taps stop (or the text is sent), so the end of recognition is final.
  const stoppedRef = useRef(false);
  /** Words already final in this session, kept across restarts and language switches. */
  const heardRef = useRef("");
  const langRef = useRef(lang);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    recRef.current?.stop();
  }, []);

  /** Stop and throw away anything still to come, e.g. after the text was sent. */
  const cancel = useCallback(() => {
    stoppedRef.current = true;
    heardRef.current = "";
    const rec = recRef.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.abort();
    recRef.current = null;
    setListening(false);
  }, []);

  const begin = useCallback((prefix: string) => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = langRef.current;
    rec.interimResults = true;
    rec.continuous = true;
    stoppedRef.current = false;
    heardRef.current = prefix;
    let ends: number[] = [];
    let sessionFinal = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) sessionFinal = joinHeard(sessionFinal, r[0].transcript);
        else interim = joinHeard(interim, r[0].transcript);
      }
      onTextRef.current(joinHeard(joinHeard(heardRef.current, sessionFinal), interim));
    };
    rec.onerror = (e) => {
      if (QUIET_ERRORS.has(e.error)) return;
      // A real problem (blocked mic, no network): stop for good instead of retrying.
      stoppedRef.current = true;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The mic is off for this site. Turn it on in your browser settings, or type instead."
          : e.error === "network"
            ? "The mic needs the internet to turn speech into text. Try again, or type instead."
            : "Hmm, that didn't come through. Tap the mic to try again.",
      );
    };
    rec.onend = () => {
      // A late end from an older recognition must not mark a newer one as stopped.
      if (recRef.current !== rec) return;
      heardRef.current = joinHeard(heardRef.current, sessionFinal);
      sessionFinal = "";
      // The browser ends recognition after its own silence limit. Unless the person tapped stop,
      // listen on: a long pause is part of speaking, not the end of it.
      const now = Date.now();
      ends = [...ends.filter((t) => now - t < 1000), now];
      if (!stoppedRef.current && ends.length < RESTART_BURST) {
        try {
          rec.lang = langRef.current;
          rec.start();
          return;
        } catch {
          // Could not restart: fall through and show the mic as off.
        }
      }
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError("Hmm, the mic didn't start. Tap it to try again.");
    }
  }, []);

  /** Starts listening. `prefix`: words already in the box, kept in front of what is heard. */
  const start = useCallback((prefix?: unknown) => begin(typeof prefix === "string" ? prefix : ""), [begin]);

  /** English (India) or Hindi. While listening, it carries on in the new language. */
  const setLang = useCallback((next: SpeechLang) => {
    langRef.current = next;
    setLangState(next);
    writeStored(LANG_KEY, next);
    // Ending the current recognition makes onend restart it with the new language.
    if (recRef.current && !stoppedRef.current) recRef.current.stop();
  }, []);

  useEffect(
    () => () => {
      stoppedRef.current = true;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop, cancel, lang, setLang };
}
