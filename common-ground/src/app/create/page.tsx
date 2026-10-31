"use client";

import { useAuth } from "@/components/auth/auth-provider";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Heart, MessageCircle, Pencil, QrCode, RotateCcw, Sparkles } from "lucide-react";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { LocationAsk } from "@/components/location-ask";
import { MoodPicker } from "@/components/mood-picker";
import { Segmented } from "@/components/ui";
import { AGE_OPTIONS, saveAgeBucket, useAgeBucket } from "@/lib/age";
import { hasAnsweredLocationAsk } from "@/lib/location";
import { showAppCardAfterWin } from "@/components/app-card";
import type { AgeBucket } from "@/lib/types/signals";
import { NameField, PicturePicker } from "@/components/picture-picker";
import { SiteHeader, SOLO_LABEL } from "@/components/site-header";
import { TasteCard } from "@/components/taste-card";
import { APP_NAME } from "@/lib/brand";
import type { Persona } from "@/lib/contracts";
import { clearPersona, personaFromProfile, personaToProfile, savePersona, usePersona } from "@/lib/persona";
import type { TasteItem } from "@/lib/types";
import { useHeightVar } from "@/lib/use-height-var";
import { cn } from "@/lib/utils";
import { PageSkeleton } from "@/components/page-skeleton";

const MIN_ITEMS = 3;
const NAME_ID = "create-name";
const AGE_ID = "create-age";

/** Where "Save my picks" goes back to in edit mode: only these, never an outside link. */
const EDIT_RETURNS = new Set(["/card", "/me"]);

// Cards are chosen once, here, at the start. After that Larry's persona grows from chats, and the
// person sees and edits it on /me ("Your taste, by Larry").
// /create?edit=1 (from "Add more picks"): the same picker with the current picks loaded, to add or
// take some off and save back to the same card. Name and age are never asked again.
export default function CreatePage() {
  return (
    <React.Suspense fallback={<PageSkeleton label="Opening your taste card" tiles />}>
      <CreateScreen />
    </React.Suspense>
  );
}

function CreateScreen() {
  const persona = usePersona();
  const params = useSearchParams();
  const editing = params.get("edit") === "1";
  const back = params.get("next") ?? "";
  // Just saved here: stay on the form while /card opens, instead of flashing "Your card is made".
  const [saved, setSaved] = React.useState(false);
  if (persona === undefined) return <PageSkeleton label="Opening your taste card" tiles />;
  if (editing && persona && persona.likes.length > 0) {
    return <CreateForm initialName={persona.name} edit={persona} returnTo={EDIT_RETURNS.has(back) ? back : "/card"} onSaved={() => setSaved(true)} />;
  }
  if (!saved && persona && persona.likes.length > 0) return <AlreadyMade persona={persona} />;
  return <CreateForm initialName={persona?.name ?? ""} onSaved={() => setSaved(true)} />;
}

/** Someone with a card already: point to where their taste grows now, with a careful way to start over. */
function AlreadyMade({ persona }: { persona: Persona }) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto grid w-full max-w-4xl flex-1 items-start gap-10 px-5 pb-16 sm:px-8 md:grid-cols-[1fr_15rem]">
        <div className="flex min-w-0 flex-col items-start gap-4">
          <h1 className="font-display text-title-page font-black leading-title">Your card is made</h1>
          <p className="max-w-measure text-lead text-ink-soft">
            You picked your cards at the start. Now {APP_NAME} learns more of your taste each time you chat. You can see and
            change everything it learned.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <LinkButton href="/larry">
              <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
            </LinkButton>
            <LinkButton href="/me" variant="secondary">
              <Sparkles className="size-5" aria-hidden /> Your taste, by {APP_NAME}
            </LinkButton>
          </div>
          <div className="-ml-4 flex flex-wrap">
            <LinkButton href="/create?edit=1" variant="quiet">
              <Pencil className="size-5" aria-hidden /> Add more picks
            </LinkButton>
            <LinkButton href="/card" variant="quiet">
              <QrCode className="size-5" aria-hidden /> Show my QR code
            </LinkButton>
          </div>

          <div className="mt-6 w-full max-w-measure border-t-2 border-line pt-5">
            {confirming ? (
              <div className="flex flex-col gap-3" role="group" aria-labelledby="start-over-q">
                <p id="start-over-q" className="font-bold">
                  Start a new card? This forgets everything {APP_NAME} learned about you on this phone.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => clearPersona()} className={cn(buttonStyles.secondary, "min-h-12")}>
                    Yes, start again
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={buttonStyles.quiet}>
                    Keep my card
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={cn(buttonStyles.quiet, "-ml-4")}>
                <RotateCcw className="size-4" aria-hidden /> Start a new card
              </button>
            )}
          </div>
        </div>
        <div className="max-md:hidden">
          <TasteCard profile={personaToProfile(persona)} total={persona.likes.length} size="md" />
        </div>
      </main>
    </div>
  );
}

function CreateForm({
  initialName,
  onSaved,
  edit,
  returnTo = "/card",
}: {
  initialName: string;
  onSaved: () => void;
  /** Edit mode: the card being changed. Its picks load, and everything else on it is kept. */
  edit?: Persona;
  returnTo?: string;
}) {
  const router = useRouter();
  // Signed in: the account already has a first name, so the card uses it and never asks again.
  const { account, status } = useAuth();
  const accountName = account?.name?.trim().split(/\s+/)[0] ?? "";
  const [typedName, setName] = React.useState(initialName);
  const name = edit ? edit.name : accountName || typedName;
  const [items, setItems] = React.useState<TasteItem[]>(() => edit?.likes ?? []);
  // Asked once, as a range. Already known (asked before, or set from a signed-in account): skipped.
  const storedAge = useAgeBucket();
  // Never asked again when signed in: the account's date of birth already gives the range.
  const askAge = !edit && storedAge === null && !account?.ageBucket && status !== "signed-in";
  const [age, setAge] = React.useState<AgeBucket | null>(null);
  const [younger, setYounger] = React.useState(false);
  const [step, setStep] = React.useState<"form" | "location">("form");
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // The phone tray sets --composer-h, so a focused field is scrolled clear of it (WCAG 2.4.11).
  const trayRef = React.useRef<HTMLDivElement>(null);
  useHeightVar(trayRef, "--composer-h");

  // What's still missing, as a plain instruction shown next to the button (never only inside it).
  const missing =
    items.length < MIN_ITEMS
      ? items.length === 0
        ? `Tap ${MIN_ITEMS} pictures.`
        : `Pick ${MIN_ITEMS - items.length} more.`
      : !name.trim() && !edit
        ? "Now add your first name."
        : askAge && !age
          ? "Last one: pick your age range."
          : null;
  const ready = !missing;
  // Save my card goes to /card (router.push, which Next does not prefetch): warm it once the card can be saved.
  React.useEffect(() => {
    if (ready) router.prefetch("/card");
  }, [ready, router]);

  const save = () => {
    if (saving) return;
    if (!ready) {
      if (items.length >= MIN_ITEMS) {
        const target = !name.trim() ? NAME_ID : AGE_ID;
        const el = document.getElementById(target);
        (el?.querySelector<HTMLElement>("[role=radio]") ?? el)?.focus();
      }
      return;
    }
    // The tap shows at once (the button turns busy); the storage writes, the re-render they cause and
    // the route change run after that paint, so a slow phone never sits on an unchanged button.
    setSaving(true);
    requestAnimationFrame(() => setTimeout(commit, 0));
  };

  const commit = () => {
    if (edit) {
      // The same card: new picks, and everything Larry learned stays.
      // New picks go first (newest first, as Larry adds them), so they are on the card and read.
      const before = new Set(edit.likes.map((l) => l.id));
      const added = items.filter((i) => !before.has(i.id)).reverse();
      const kept = items.filter((i) => before.has(i.id));
      savePersona({ ...edit, likes: [...added, ...kept], updatedAt: Date.now() });
      router.push(returnTo);
      return;
    }
    if (askAge && age && !saveAgeBucket(age)) {
      setSaveFailed(true);
      setSaving(false);
      return;
    }
    onSaved();
    savePersona(personaFromProfile({ name: name.trim(), items }));
    // A saved card is a win: recorded now, so the app card can be offered from the next visit
    // (never on a first visit, and the person moves on to /card here anyway).
    showAppCardAfterWin("card-saved");
    // D24: the one location ask comes right after "Save my card", and only once.
    if (!hasAnsweredLocationAsk()) setStep("location");
    else router.push("/card");
  };

  if (younger) return <TooYoung onBack={() => setYounger(false)} />;

  if (step === "location") {
    return (
      <div className="flex flex-1 flex-col">
        <SiteHeader />
        <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
          <p className="font-bold text-ink">Your card is saved. One quick question.</p>
          <LocationAsk headingLevel={1} onDone={() => router.push("/card")} />
        </main>
      </div>
    );
  }

  const ageQuestion = askAge && (
    <div id={AGE_ID} className="mt-10 flex max-w-xl flex-col gap-2">
      <Segmented
        label="How old are you?"
        labelClassName="text-body"
        options={AGE_OPTIONS}
        value={age}
        onChange={setAge}
      />
      <p className="text-label text-ink-soft">
        It helps {APP_NAME} pick things that fit. It is never shown to anyone.
      </p>
      <button
        type="button"
        onClick={() => setYounger(true)}
        className="press press-flat -ml-3 min-h-12 w-fit rounded-full px-3 text-label font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-paper"
      >
        I&apos;m younger
      </button>
      {saveFailed && (
        <p role="alert" className="text-label font-bold text-danger">
          Hmm, that didn&apos;t save. Try again in a moment?
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-5 pb-36 sm:px-8 lg:grid-cols-[1fr_20rem] lg:pb-16">
        <div className="min-w-0">
          <h1 className="font-display text-title-page font-black leading-title">{edit ? "Add more picks" : "Make your taste card"}</h1>
          <p className="mt-3 max-w-measure text-lead text-ink-soft">
            {edit
              ? `Your picks are kept. Add more things you love, or take some off. Keep at least ${MIN_ITEMS}.`
              : `Tap ${MIN_ITEMS} or more things you love. Pick as many as you like.`}
          </p>

          {/* Pictures first, so they are on the first screen of a phone. */}
          <div className="mt-6">
            <PicturePicker selected={items} onChange={setItems} />
          </div>

          <div className={accountName || edit ? "hidden" : "mt-10"}>
            <NameField
              id={NAME_ID}
              value={name}
              onChange={setName}
              placeholder="e.g. Sam"
              hint="Only your first name. It goes on your card."
            />
          </div>

          {ageQuestion}

          {/* Optional, and changeable any time from the chat screens. */}
          {!edit && <MoodPicker className="mt-10 max-w-xl" label="How are you feeling today? (optional)" />}
        </div>

        {/* Live preview: sticky beside the picker on wide screens. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 flex flex-col items-center gap-5">
            <TasteCard profile={{ name: name.trim() || "Your name", items }} total={items.length} />
            <p id="create-missing-wide" className="min-h-7 text-center font-bold text-ink">
              {missing ?? "Ready when you are."}
            </p>
            {/* The button reads out what's still missing, so a tap that does nothing is never a mystery (3.3.1). */}
            <button
              type="button"
              onClick={save}
              aria-disabled={!ready}
              aria-busy={saving || undefined}
              aria-describedby={missing ? "create-missing-wide" : undefined}
              className={cn(buttonStyles.primary, "-mt-2 w-full")}
            >
              {edit ? "Save my picks" : "Save my card"}{" "}
              {saving ? <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden /> : ready && <ArrowRight className="size-5" aria-hidden />}
            </button>
          </div>
        </aside>
      </main>

      {/* On phones the card collapses into a tray so the picker keeps the screen. */}
      <div
        ref={trayRef}
        role="region"
        aria-label="Your card so far"
        className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-ink bg-paper px-4 py-3 lg:hidden"
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <p className="min-w-0 leading-snug text-ink">
            <span className="font-bold">
              {items.length} picked
            </span>
            {missing && (
              <span id="create-missing" className="block text-label">
                {missing}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={save}
            aria-disabled={!ready}
            aria-busy={saving || undefined}
            aria-describedby={missing ? "create-missing" : undefined}
            className={cn(buttonStyles.primary, "ml-auto min-h-12 shrink-0 px-5")}
          >
            {edit ? "Save my picks" : "Save my card"}
            {saving && <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Under 13: no card, a kind message (minimum age 13, next-round-queue.md "Age"). */
function TooYoung({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-5 px-5 pb-16">
        <Heart className="size-10 text-ink" aria-hidden />
        <h1 className="font-display text-title-lg font-black leading-title">Thanks for stopping by!</h1>
        <p className="text-lead text-ink-soft">
          {APP_NAME} is for people who are 13 or older. We&apos;d love to meet you then. Nothing was saved.
        </p>
        <button type="button" onClick={onBack} className={cn(buttonStyles.quiet, "-ml-4")}>
          <ArrowLeft className="size-5" aria-hidden /> I picked by mistake
        </button>
      </main>
    </div>
  );
}
