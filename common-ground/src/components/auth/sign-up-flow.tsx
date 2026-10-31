"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, RefreshCw, UserRoundPlus } from "lucide-react";
import { LarryMoment } from "@/components/larry-avatar";
import { LinkButton } from "@/components/link-button";
import { Button, Field, SelectField } from "@/components/ui";
import { safeNext } from "@/lib/account/next-path";
import { authFetch } from "@/lib/firebase/client";
import { cleanName, NAME_MAX } from "@/lib/sanitize";
import type { Account, SignupRequest } from "@/lib/types/account";
import { useAuth } from "./auth-provider";
import { EnergyQuote } from "./energy-quote";
import { WhatWeStore } from "./what-we-store";

// /signup: one question per screen, after the phone is verified. What we keep, then name, then a
// generated username (with a re-roll), then date of birth as three selects. The 18+ check runs on
// the server; under 18 gets a kind exit and keeps the device-only Larry.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Step = "store" | "name" | "username" | "dob" | "under-18" | "done";
const ORDER: Step[] = ["store", "name", "username", "dob"];

export function SignUpFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status, account, setAccount, signOut } = useAuth();
  const [step, setStep] = React.useState<Step>("store");
  const [name, setName] = React.useState("");
  const [username, setUsername] = React.useState<string | null>(null);
  const [dob, setDob] = React.useState({ d: "", m: "", y: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Account | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  async function reroll() {
    try {
      const res = await fetch("/api/account/username", { cache: "no-store" });
      if (res.ok) setUsername(((await res.json()) as { username: string }).username);
    } catch {
      setError("Hmm, that didn't go through. Try again in a moment?");
    }
  }

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    if (s === "username" && !username) void reroll();
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (status === "loading") return <p role="status">Checking your sign-in…</p>;
  if (status === "signed-out" && !made) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="max-w-measure text-lead">First, sign in with your phone. It takes a minute.</p>
        <LinkButton href={`/signin?next=${encodeURIComponent(next)}`}>Sign in with your phone</LinkButton>
      </div>
    );
  }
  if (status === "signed-in" && account && !made) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="max-w-measure text-lead">You already have an account: {account.username}.</p>
        <LinkButton href={next}>Carry on</LinkButton>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !username) return;
    const body: SignupRequest = { name: cleanName(name), username, dob: { d: Number(dob.d), m: Number(dob.m), y: Number(dob.y) } };
    if (!body.dob.d || !body.dob.m || !body.dob.y) {
      setError("Pick your day, month and year.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Account & { error?: string; reason?: string };
      if (res.ok) {
        setMade(data);
        setAccount(data);
        go("done");
      } else if (data.reason === "under-18") {
        go("under-18");
      } else if (data.reason === "username-taken") {
        go("username");
        void reroll();
        setError(data.error ?? "Someone just took that name. Here is a fresh one.");
      } else {
        setError(data.error ?? "Hmm, that didn't go through. Try again in a moment?");
      }
    } catch {
      setError("Hmm, that didn't go through. Try again in a moment?");
    } finally {
      setBusy(false);
    }
  }

  const stepNo = ORDER.indexOf(step);
  const back = stepNo > 0 && (
    <Button variant="quiet" icon={<ArrowLeft />} onClick={() => go(ORDER[stepNo - 1])}>
      Back
    </Button>
  );
  const heading = (text: string) => (
    <div className="flex flex-col gap-1">
      {stepNo >= 0 && <p className="text-label font-bold text-ink-soft">Step {stepNo + 1} of {ORDER.length}</p>}
      <h2 ref={headingRef} tabIndex={-1} className="font-display text-title-md font-black">
        {text}
      </h2>
    </div>
  );

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => thisYear - 13 - i);

  return (
    <div className="flex max-w-xl flex-col gap-5">
      {step === "store" && (
        <>
          {heading("Before we start")}
          <EnergyQuote />
          <details className="max-w-md">
            <summary className="flex min-h-12 cursor-pointer items-center font-bold underline decoration-2 underline-offset-4">What we keep</summary>
            <WhatWeStore compact className="mt-2" />
          </details>
          <Button icon={<ArrowRight />} className="self-start" onClick={() => go("name")}>
            Sounds good
          </Button>
        </>
      )}

      {step === "name" && (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!cleanName(name)) setError("Add your name, even just a first name.");
            else go("username");
          }}
        >
          {heading("What should Larry call you?")}
          <Field
            label="Your name"
            hint="A first name is plenty. Strangers never see it."
            autoComplete="given-name"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
            error={error ?? undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" icon={<ArrowRight />}>
              Next
            </Button>
            {back}
          </div>
        </form>
      )}

      {step === "username" && (
        <div className="flex flex-col gap-4">
          {heading("Your public name")}
          <p className="max-w-measure">
            This is the name other people see. It&apos;s made up on purpose, so it never points back to you.
          </p>
          <p aria-live="polite" className="rounded-mini border-2 border-ink bg-paper px-4 py-3 font-display text-title-sm font-black">
            {username ?? "Picking one…"}
          </p>
          {error && (
            <p role="alert" className="font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={<ArrowRight />} disabled={!username} onClick={() => username && go("dob")}>
              Use this name
            </Button>
            <Button variant="secondary" icon={<RefreshCw />} onClick={() => void reroll()}>
              New name
            </Button>
            {back}
          </div>
        </div>
      )}

      {step === "dob" && (
        <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
          {heading("When were you born?")}
          <p id="dob-why" className="max-w-measure">
            To check you&apos;re 18 or over. Nobody sees it.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1.4fr]">
            <SelectField label="Day" value={dob.d} onChange={(e) => setDob({ ...dob, d: e.target.value })} aria-describedby="dob-why">
              <option value="">Day</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </SelectField>
            <SelectField label="Month" value={dob.m} onChange={(e) => setDob({ ...dob, m: e.target.value })}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectField>
            <SelectField label="Year" value={dob.y} onChange={(e) => setDob({ ...dob, y: e.target.value })}>
              <option value="">Year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectField>
          </div>
          {error && (
            <p role="alert" className="font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy} icon={<UserRoundPlus />}>
              {busy ? "Making it…" : "Make my account"}
            </Button>
            {back}
          </div>
        </form>
      )}

      {step === "under-18" && (
        <div className="flex flex-col items-start gap-4">
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-title-md font-black">
            Larry still has your back
          </h2>
          <p className="max-w-measure text-lead">
            Accounts are for people 18 and over. You can keep using Larry on this phone without one: your card, places and
            plans all still work. We didn&apos;t keep anything you typed here.
          </p>
          <Button
            icon={<ArrowRight />}
            onClick={async () => {
              // Removes the sign-in record too; no account was ever made.
              await authFetch("/api/account", { method: "DELETE" }).catch(() => null);
              await signOut();
              router.replace("/");
            }}
          >
            Back to Larry
          </Button>
        </div>
      )}

      {step === "done" && made && (
        <div className="flex flex-col items-start gap-4">
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            You&apos;re in
          </h2>
          <LarryMoment kind="verified" layout="row" title={`Welcome, ${made.username}. You're in.`}>
            <p className="text-ink-soft">Your own Larry time is ready, and your progress now follows you to any phone.</p>
          </LarryMoment>
          <LinkButton href={next}>
            <Check aria-hidden className="size-5" /> Carry on
          </LinkButton>
        </div>
      )}
    </div>
  );
}
