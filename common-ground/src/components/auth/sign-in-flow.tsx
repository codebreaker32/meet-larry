"use client";

import * as React from "react";
import { LocationAsk } from "@/components/location-ask";
import { hasAnsweredLocationAsk } from "@/lib/location";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LogIn, MessageSquareText } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { safeNext } from "@/lib/account/next-path";
import {
  authFetch,
  type PendingSignIn,
  PhoneSignInError,
  type SignInError,
  sendSignInCode,
  signInAvailable,
  toE164,
} from "@/lib/firebase/client";
import { useAuth } from "./auth-provider";
import { EnergyQuote } from "./energy-quote";

// /signin: phone number, then the 6-digit SMS code. One field per screen, SMS only, and no
// countdown that reads like a deadline. A warm quote, then "What we keep" above the phone field
// (PRODUCT.md Accounts: what is stored is shown plainly before the phone field).

const ERROR_TEXT: Record<SignInError, string> = {
  "bad-number": "That number doesn't look right. Check it and try again.",
  "bad-code": "That code didn't match. Check the text and try again.",
  expired: "That code has expired. Tap Send a new code and we'll text you another.",
  "too-many": "Lots of tries at once. Give it a few minutes, then try again.",
  network: "Hmm, that didn't go through. Check your connection and try again?",
  unavailable: "Hmm, that didn't go through. Try again in a moment?",
};

export function SignInFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status } = useAuth();
  const [step, setStep] = React.useState<"phone" | "code" | "location">("phone");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  // True while confirm() is finishing a sign-in. The auth provider may report "signed-in" first
  // (it hears the sign-in at once); confirm() then decides: the location ask (D24) or straight on.
  const [confirming, setConfirming] = React.useState(false);
  const pending = React.useRef<PendingSignIn | null>(null);
  const recaptchaRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Already signed in (another tab, or back button): carry on.
  React.useEffect(() => {
    if (step === "location" || confirming) return; // the one location ask first (D24), then on
    if (status === "signed-in") router.replace(next);
    else if (status === "needs-signup") router.replace(`/signup?next=${encodeURIComponent(next)}`);
  }, [status, next, router, step, confirming]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const e164 = toE164(phone);
    if (!e164) {
      setError(ERROR_TEXT["bad-number"]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      pending.current = await sendSignInCode(e164, recaptchaRef.current!);
      setStep("code");
      setCode("");
      setNote("We sent a 6-digit code by text message.");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (err) {
      setError(ERROR_TEXT[err instanceof PhoneSignInError ? err.reason : "unavailable"]);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pending.current) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("The code has 6 numbers. Check the text and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    setConfirming(true);
    try {
      await pending.current.confirm(digits);
      const res = await authFetch("/api/account", { cache: "no-store" });
      // A new phone that never answered the location ask gets it once here (D24), then carries on.
      if (res.ok && !hasAnsweredLocationAsk()) {
        setStep("location");
        setBusy(false);
        return;
      }
      router.replace(res.ok ? next : `/signup?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(ERROR_TEXT[err instanceof PhoneSignInError ? err.reason : "unavailable"]);
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!signInAvailable()) {
    return <p className="max-w-measure text-lead">Phone sign-in isn&apos;t switched on here yet. Everything else in Larry still works on this phone.</p>;
  }

  if (step === "location") {
    return <LocationAsk onDone={() => router.replace(next)} headingLevel={2} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {step === "phone" ? (
        <>
          <EnergyQuote />
          <form onSubmit={sendCode} className="flex max-w-md flex-col gap-4" noValidate>
            <Field
              label="Your phone number"
              hint="We'll text you a 6-digit code. Indian numbers can skip the +91."
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(ev) => setPhone(ev.target.value.slice(0, 20))}
              error={error ?? undefined}
              placeholder="98765 43210"
            />
            <Button type="submit" loading={busy} icon={<MessageSquareText />} className="self-start">
              {busy ? "Sending…" : "Text me a code"}
            </Button>
          </form>
        </>
      ) : (
        <form onSubmit={confirm} className="flex max-w-md flex-col gap-4" noValidate>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-title-sm font-black">
            Check your texts
          </h2>
          <p role="status" className="text-ink-soft">
            {note}
          </p>
          <Field
            label="The 6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, "").slice(0, 6))}
            error={error ?? undefined}
            inputClassName="text-lead tracking-widest"
          />
          <Button type="submit" loading={busy} icon={<LogIn />} className="self-start">
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" icon={<MessageSquareText />} onClick={() => void sendCode()}>
              Send a new code
            </Button>
            <Button
              variant="quiet"
              icon={<ArrowLeft />}
              onClick={() => {
                setStep("phone");
                setError(null);
              }}
            >
              Use a different number
            </Button>
          </div>
        </form>
      )}
      {/* The invisible reCAPTCHA attaches here. */}
      <div ref={recaptchaRef} />
    </div>
  );
}
