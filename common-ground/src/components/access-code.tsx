"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, KeyRound, LogIn } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { LinkButton } from "@/components/link-button";
import { Button, Dialog, fieldStyles } from "@/components/ui";
import { verifyAccessCode } from "@/lib/access/actions";
import { ACCESS_CODE_EXAMPLE, ACCESS_TEXT, type AccessState } from "@/lib/access/shared";
import {
  ACCESS_EVENT,
  type AccessNeeded,
  clearAccessCode,
  saveAccessCode,
  takeUnseenAccess,
  useAccessCode,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** "About half of its AI time left." Words, no numbers to worry about. */
function leftText(left: number): string {
  if (left > 0.9) return "It has all of its AI time left.";
  if (left > 0.6) return "It has most of its AI time left.";
  if (left > 0.35) return "It has about half of its AI time left.";
  if (left > 0.1) return "It has a little AI time left.";
  return "It is almost out of AI time.";
}

/**
 * Enter an access code once; it is checked on the server and remembered on this device.
 * Used on /code and inside the prompt that opens when an AI route asks for a code.
 */
export function AccessCodeForm({
  onSaved,
  autoFocus,
  inputRef,
  className,
}: {
  onSaved?: (code: string) => void;
  autoFocus?: boolean;
  /** The code field, so a Dialog can give it first focus (`initialFocus`). */
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}) {
  const saved = useAccessCode();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const inputId = React.useId();
  const hintId = React.useId();
  const statusId = React.useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const res = await verifyAccessCode(value);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        saveAccessCode(res.code);
        setValue("");
        setDone(`Code saved on this phone. ${leftText(res.left)}`);
        onSaved?.(res.code);
      } catch {
        setError("Couldn't check the code right now. Try again in a minute.");
      }
    });
  }

  return (
    <form onSubmit={submit} className={cn("flex max-w-md flex-col gap-3", className)} noValidate>
      {saved && !done && (
        <div className="flex flex-wrap items-center gap-2 rounded-mini border-2 border-line bg-paper p-3">
          <Check aria-hidden className="size-5 shrink-0" />
          <p className="flex-1">
            This phone has a code saved: <span className="font-bold">{saved}</span>
          </p>
          <Button variant="quiet" onClick={clearAccessCode}>
            Remove it
          </Button>
        </div>
      )}
      <label htmlFor={inputId} className="font-bold">
        {saved ? "Use a different code" : "Your access code"}
      </label>
      <p id={hintId} className="text-ink-soft">
        It looks like {ACCESS_CODE_EXAMPLE}. You only type it once on this phone.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 40))}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          placeholder={ACCESS_CODE_EXAMPLE}
          aria-describedby={`${hintId} ${statusId}`}
          aria-invalid={error ? true : undefined}
          className={fieldStyles("md", "text-lead uppercase placeholder:normal-case")}
        />
        <Button type="submit" loading={pending} icon={<KeyRound />} className="shrink-0">
          {pending ? "Checking…" : "Save code"}
        </Button>
      </div>
      <p id={statusId} role="status" aria-live="polite" className={cn("min-h-6", error ? "font-bold text-danger" : "text-ink")}>
        {error ?? done ?? ""}
      </p>
    </form>
  );
}

const PROMPT_TITLE: Record<AccessState, string> = {
  missing: "Get your Larry time",
  invalid: "That code didn't work",
  spent: "That's your Larry time for now",
};

const PROMPT_TEXT: Record<AccessState, string> = {
  missing: ACCESS_TEXT.missing,
  invalid: "Check the code and type it again.",
  spent: "Everything else (your card, places, plans) still works. Have an access code? Type it below.",
};

/**
 * Mount once on pages that call AI routes through apiFetch. It opens by itself when a route
 * answers 401/402, lets the person type a code, and closes once the code is saved. The caller
 * can listen for ACCESS_SAVED_EVENT to try again.
 */
export function AccessCodePrompt() {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<AccessState | null>(null);
  const [saved, setSaved] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement>(null);
  const { status } = useAuth();
  const pathname = usePathname() ?? "/";
  // Signing in is the main way to get Larry time; codes stay for people without an account.
  const offerSignIn = status === "signed-out" || status === "needs-signup";

  React.useEffect(() => {
    const onNeed = (e: Event) => {
      const detail = (e as CustomEvent<AccessNeeded>).detail;
      if (!detail?.state) return;
      takeUnseenAccess(); // seen now
      setState(detail.state);
      setSaved(false);
      setOpen(true);
    };
    window.addEventListener(ACCESS_EVENT, onNeed);
    // A page's first request can be turned away before this prompt streams in: catch up once.
    const missed = takeUnseenAccess();
    if (missed) onNeed(new CustomEvent<AccessNeeded>(ACCESS_EVENT, { detail: { state: missed } }));
    return () => window.removeEventListener(ACCESS_EVENT, onNeed);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onClosed={() => setState(null)}
      size="md"
      initialFocus={fieldRef}
      title={saved ? "Code saved" : state ? PROMPT_TITLE[state] : ""}
      description={saved ? "Thanks. Try that again now." : state ? PROMPT_TEXT[state] : undefined}
    >
      {state &&
        (saved ? (
          <Button onClick={() => setOpen(false)} className="w-full">
            Okay
          </Button>
        ) : (
          <div className="flex flex-col gap-4">
            {offerSignIn && (
              <LinkButton href={`${status === "needs-signup" ? "/signup" : "/signin"}?next=${encodeURIComponent(pathname)}`} className="w-full">
                <LogIn aria-hidden className="size-5" />
                {status === "needs-signup" ? "Finish sign-up" : "Sign in with your phone"}
              </LinkButton>
            )}
            <AccessCodeForm inputRef={fieldRef} onSaved={() => setSaved(true)} />
            <p className="text-ink-soft">
              {offerSignIn ? "No code? Signing in gives you your own Larry time." : "No code? Ask the person who shared Larry with you."}
            </p>
          </div>
        ))}
    </Dialog>
  );
}

/** A safe in-app path from ?next=, else /larry. Never another site. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/larry";
  return raw.slice(0, 200);
}

/** The body of /code: the form, then a way back to where the person came from. */
export function AccessCodePageBody() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [saved, setSaved] = React.useState(false);
  return (
    <div className="flex flex-col gap-5">
      <AccessCodeForm autoFocus onSaved={() => setSaved(true)} />
      {saved && (
        <LinkButton href={next} className="self-start">
          Continue
        </LinkButton>
      )}
    </div>
  );
}
