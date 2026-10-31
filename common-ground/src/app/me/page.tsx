"use client";

import * as React from "react";
import { Check, MapPin, MessageCircle, NotebookPen, Pencil, Plus, Smartphone, ThumbsDown, Trash2, Undo2, X } from "lucide-react";
import { AccountSection } from "@/components/auth/account-section";
import { useAuth } from "@/components/auth/auth-provider";
import { FingerprintPanel } from "@/components/fingerprint/fingerprint-panel";
import { FriendsList } from "@/components/profile/friends-list";
import { OwnerSection } from "@/components/profile/owner-section";
import { buttonStyles, LinkButton } from "@/components/link-button";
import { Thumb } from "@/components/picture-picker";
import { SiteHeader, SOLO_LABEL } from "@/components/site-header";
import { chipStyles, fieldStyles, Segmented, Switch } from "@/components/ui";
import { AGE_OPTIONS, saveAgeBucket, useAgeBucket } from "@/lib/age";
import { APP_NAME } from "@/lib/brand";
import type { Persona } from "@/lib/contracts";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import { setLocationEnabled, useApproxLocation } from "@/lib/location";
import { CARD_TOP, clearPersona, NOTES_MAX, personaToProfile, savePersona, usePersona, vibeWords } from "@/lib/persona";
import { cleanItemName, cleanName, NAME_MAX } from "@/lib/sanitize";
import { DOMAIN_KEYS } from "@/lib/types";
import type { AgeBucket } from "@/lib/types/signals";
import { cn } from "@/lib/utils";

// "Your taste, by Larry": everything Larry knows about this person's taste, on this phone only.
// Every part can be changed or removed by tapping; typing is only needed to add words of your own.

const VIBES: { key: NonNullable<Persona["placeVibe"]>; label: string }[] = [
  { key: "calm", label: "Calm" },
  { key: "cosy", label: "Cosy" },
  { key: "lively", label: "Lively" },
];

// Removable chips: the shared chip, starting with a thumbnail and ending with the X.
const chip = chipStyles({ className: "justify-start py-1 pl-1 pr-3" });
// The shared field: a 3:1 edge at rest (WCAG 1.4.11) and the global focus ring (2.4.7).
const field = fieldStyles("sm");

export default function MePage() {
  const persona = usePersona();
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 sm:px-8">
        <h1 className="font-display text-title-page font-black leading-title">Your taste, by {APP_NAME}</h1>
        <StaysHere />
        <OwnerSection className="mt-8" />
        {persona === undefined ? null : persona === null || isEmpty(persona) ? (
          <NoTaste />
        ) : (
          <>
            <FingerprintPanel profile={persona.likes.length ? personaToProfile(persona) : null} className="mt-8" />
            <Editor persona={persona} />
          </>
        )}
        <Friends />
        <Settings />
        <AccountSection className="mt-8" />
      </main>
    </div>
  );
}

const isEmpty = (p: Persona) => !p.likes.length && !p.dislikes.length && !p.notes.length && !p.placeVibe;

function StaysHere() {
  return (
    <div className="mt-4 flex max-w-measure items-start gap-3 rounded-mini bg-paper p-3 ring-2 ring-line">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-paper">
        <Smartphone className="size-5" />
      </span>
      <p className="leading-snug">
        If you sign in, it syncs to your account. It is sent
        only with your own chats, so {APP_NAME} can use it. {APP_NAME} is an AI. Change or remove anything here.
      </p>
    </div>
  );
}

function NoTaste() {
  return (
    <section className="mt-8 flex max-w-md flex-col items-start gap-4">
      <h2 className="font-display text-title-sm font-black">Nothing here yet</h2>
      <p className="text-lead text-ink-soft">Make your taste card first. Then {APP_NAME} learns more each time you chat.</p>
      <LinkButton href="/create">Make my taste card</LinkButton>
    </section>
  );
}

function Editor({ persona }: { persona: Persona }) {
  // One step of undo for anything changed on this page.
  const [undo, setUndo] = React.useState<{ before: Persona; text: string } | null>(null);
  const [confirmForget, setConfirmForget] = React.useState(false);

  // The "Took off ... Undo" note goes away by itself after a few seconds, so it never sticks on screen.
  React.useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 5000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const change = (next: Persona, text: string) => {
    setUndo({ before: persona, text });
    savePersona({ ...next, updatedAt: Date.now() });
  };

  const onCard = new Set(persona.likes.slice(0, CARD_TOP).map((l) => l.id));
  const domains = DOMAIN_KEYS.filter((d) => persona.likes.some((l) => l.domain === d));

  return (
    <>
      <div role="status" aria-live="polite" className="sticky top-2 z-10 mt-4 min-h-0">
        {undo && (
          <p className="flex flex-wrap items-center gap-2 rounded-full bg-ink py-1 pl-4 pr-1 text-paper shadow-panel">
            <span className="min-w-0 flex-1 font-bold">{undo.text}</span>
            <button
              type="button"
              onClick={() => {
                savePersona(undo.before);
                setUndo(null);
              }}
              className="press press-flat flex min-h-12 items-center gap-2 rounded-full bg-paper px-4 font-bold text-ink hover:bg-table"
            >
              <Undo2 className="size-4" aria-hidden /> Undo
            </button>
          </p>
        )}
      </div>

      <NameRow persona={persona} onChange={change} />

      <section aria-labelledby="likes-title" className="mt-10">
        <h2 id="likes-title" className="font-display text-title-sm font-black">
          What you like
        </h2>
        <p className="mt-1 text-ink-soft">
          Your picks, and things {APP_NAME} learned in chats. Your QR card shows the first {CARD_TOP}. Tap one to take it off.
        </p>
        {domains.length === 0 ? (
          <p className="mt-3 rounded-mini border-2 border-dashed border-border-subtle px-4 py-3 text-ink-soft">Nothing yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-6">
            {domains.map((d) => {
              const { label, color, Icon } = DOMAIN_STYLE[d];
              return (
                <div key={d}>
                  <h3 className="flex items-center gap-2 font-bold">
                    <span aria-hidden className="grid size-7 place-items-center rounded-full" style={{ background: color }}>
                      <Icon className="size-4 text-ink" />
                    </span>
                    {label}
                  </h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {persona.likes
                      .filter((l) => l.domain === d)
                      .map((item) => (
                        <li key={item.id} className="max-w-full">
                          <button
                            type="button"
                            onClick={() =>
                              change({ ...persona, likes: persona.likes.filter((l) => l.id !== item.id) }, `Took off ${item.name}.`)
                            }
                            className={chip}
                          >
                            {/* The name is the visible words plus a hidden "Remove" (WCAG 2.5.3 Label in Name). */}
                            <span className="sr-only">Remove </span>
                            <Thumb item={item} />
                            <span className="truncate">{item.name}</span>
                            {onCard.has(item.id) && (
                              <span className="shrink-0 rounded-full bg-table px-2 py-0.5 text-caption text-ink">
                                <span className="sr-only">, </span>On card
                              </span>
                            )}
                            <X className="size-5 shrink-0" aria-hidden />
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="dislikes-title" className="mt-10">
        <h2 id="dislikes-title" className="font-display text-title-sm font-black">
          Not for you
        </h2>
        <p className="mt-1 text-ink-soft">{APP_NAME} won&apos;t suggest these.</p>
        {persona.dislikes.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {persona.dislikes.map((d) => (
              <li key={`${d.id ?? ""}-${d.name}`} className="max-w-full">
                <button
                  type="button"
                  aria-label={`Remove ${d.name} from not for you`}
                  onClick={() => change({ ...persona, dislikes: persona.dislikes.filter((x) => x !== d) }, `Took ${d.name} off the list.`)}
                  className={cn(chip, "pl-2")}
                >
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-table">
                    <ThumbsDown className="size-4" />
                  </span>
                  <span className="truncate">{d.name}</span>
                  <X className="size-5 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddLine
          label="Add something you don't enjoy"
          placeholder="e.g. horror films"
          onAdd={(text) => {
            const name = cleanItemName(text);
            if (!name || persona.dislikes.some((d) => d.name.toLowerCase() === name.toLowerCase())) return;
            const likes = persona.likes.filter((l) => l.name.toLowerCase() !== name.toLowerCase());
            change({ ...persona, likes, dislikes: [{ name }, ...persona.dislikes] }, `Added ${name} to not for you.`);
          }}
        />
      </section>

      <section aria-labelledby="notes-title" className="mt-10">
        <h2 id="notes-title" className="font-display text-title-sm font-black">
          {APP_NAME}&apos;s notes
        </h2>
        <p className="mt-1 text-ink-soft">Short things {APP_NAME} noticed when you chatted. Fix or remove any of them.</p>
        {persona.notes.length === 0 ? (
          <p className="mt-3 rounded-mini border-2 border-dashed border-border-subtle px-4 py-3 text-ink-soft">
            No notes yet. They appear as you chat.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {persona.notes.map((note, i) => (
              <NoteRow
                key={`${i}-${note}`}
                note={note}
                onSave={(text) => {
                  const clean = cleanItemName(text);
                  if (!clean || clean === note) return;
                  const notes = persona.notes.map((n, j) => (j === i ? clean : n));
                  change({ ...persona, notes }, "Note changed.");
                }}
                onRemove={() => change({ ...persona, notes: persona.notes.filter((_, j) => j !== i) }, "Note removed.")}
              />
            ))}
          </ul>
        )}
        {persona.notes.length < NOTES_MAX && (
          <AddLine
            label={`Add a note for ${APP_NAME}`}
            placeholder="e.g. I play cricket and like quiet cafés"
            onAdd={(text) => {
              const clean = cleanItemName(text);
              if (clean) change({ ...persona, notes: [clean, ...persona.notes] }, "Note added.");
            }}
          />
        )}
      </section>

      <section aria-labelledby="vibe-title" className="mt-10">
        <h2 id="vibe-title" className="font-display text-title-sm font-black">
          Places you like
        </h2>
        <p className="mt-1 text-ink-soft">
          {persona.placeVibe
            ? `${APP_NAME} looks for ${vibeWords(persona.placeVibe)} first.`
            : `${APP_NAME} doesn't know yet. It starts with calm places.`}
        </p>
        <div role="group" aria-labelledby="vibe-title" className="mt-3 flex flex-wrap gap-2">
          {VIBES.map(({ key, label }) => {
            const active = persona.placeVibe === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  change(
                    active ? { ...persona, placeVibe: undefined } : { ...persona, placeVibe: key },
                    active ? "Place type cleared." : `${label} places first.`,
                  )
                }
                className={cn(
                  "press press-soft flex min-h-12 items-center gap-2 rounded-full border-2 px-5 font-bold",
                  active ? "border-ink bg-ink text-paper" : "border-border-subtle bg-paper text-ink hover:border-border-control",
                )}
              >
                {active && <Check className="size-4" aria-hidden />}
                {label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-12 flex flex-col items-start gap-4 border-t-2 border-line pt-6">
        <LinkButton href="/larry">
          <MessageCircle className="size-5" aria-hidden /> {SOLO_LABEL}
        </LinkButton>
        {confirmForget ? (
          <div role="group" aria-labelledby="forget-q" className="flex flex-col gap-3">
            <p id="forget-q" className="font-bold">
              Forget everything? Your card and all {APP_NAME} learned go from this phone. This can&apos;t be undone.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => clearPersona()} className={cn(buttonStyles.secondary, "min-h-12")}>
                <Trash2 className="size-4" aria-hidden /> Yes, forget it all
              </button>
              <button type="button" onClick={() => setConfirmForget(false)} className={buttonStyles.quiet}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmForget(true)} className={cn(buttonStyles.quiet, "-ml-4")}>
            <Trash2 className="size-4" aria-hidden /> Forget everything
          </button>
        )}
      </section>
    </>
  );
}

/** Friends (accounts only): the people you share a group with, each with one-tap Unfriend. */
function Friends() {
  const { status, account } = useAuth();
  if (status !== "signed-in" || !account) return null;
  return <FriendsList sharingWithFriends={account.sharingWithFriends} className="mt-12 border-t-2 border-line pt-6" />;
}

/**
 * Settings: the age range (asked once at card creation, editable here), the one "Places near you"
 * switch (D24: the only place location is turned on or off after onboarding), and the account.
 */
function Settings() {
  return (
    <section id="settings" aria-labelledby="settings-title" className="mt-12 flex scroll-mt-20 flex-col gap-8 border-t-2 border-line pt-6">
      <h2 id="settings-title" className="font-display text-title-sm font-black">
        Settings
      </h2>
      <PlacesNearYou />
      <AgeRange />
    </section>
  );
}

function PlacesNearYou() {
  const { choice } = useApproxLocation();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState("");
  const on = choice === "on";

  const flip = async (next: boolean) => {
    setBusy(true);
    setNote("");
    const point = await setLocationEnabled(next);
    setBusy(false);
    if (!next) setNote("Places near you are off. Your location is forgotten on this phone.");
    else if (point) setNote(`Places near you are on. ${APP_NAME} only keeps a rough spot, about 1 km, on this phone.`);
    else setNote("Your browser said not now. You can allow location in your browser settings, then try again.");
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Switch
        checked={on}
        onCheckedChange={flip}
        busy={busy}
        label="Places near you"
        icon={<MapPin className="size-5" aria-hidden />}
        description={`${APP_NAME} finds real places close by. It uses only a rough spot, about 1 km. Check-ins read your exact spot once, then forget it.`}
      />
      <p role="status" aria-live="polite" className="font-bold empty:hidden">
        {note}
      </p>
    </div>
  );
}

function AgeRange() {
  const age = useAgeBucket();
  const { status } = useAuth();
  const fromAccount = status === "signed-in";
  const [note, setNote] = React.useState("");
  if (age === undefined) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <Segmented<AgeBucket>
        label="Your age range"
        options={AGE_OPTIONS}
        value={age}
        disabled={fromAccount}
        onChange={(b) => {
          if (fromAccount) return;
          setNote(saveAgeBucket(b) ? "Age range saved." : "Hmm, that didn't save. Try again in a moment?");
        }}
      />
      <p className="max-w-measure text-ink-soft">
        {fromAccount
          ? "Your account sets this from your date of birth, so it always matches."
          : `${APP_NAME} uses it for ideas that suit your age. It is never shown to anyone.`}
      </p>
      <p role="status" aria-live="polite" className="font-bold empty:hidden">
        {note}
      </p>
    </div>
  );
}

function NameRow({ persona, onChange }: { persona: Persona; onChange: (p: Persona, text: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(persona.name);
  const inputId = React.useId();
  const editRef = React.useRef<HTMLButtonElement>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const name = cleanName(value);
    if (name && name !== persona.name) onChange({ ...persona, name }, `Your name is now ${name}.`);
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  if (!editing) {
    return (
      <p className="mt-6 flex flex-wrap items-center gap-2 text-lead">
        <span>
          Name on your card: <span className="font-bold">{persona.name || "not set"}</span>
        </span>
        <button
          ref={editRef}
          type="button"
          onClick={() => {
            setValue(persona.name);
            setEditing(true);
          }}
          className={cn(buttonStyles.quiet, "px-3")}
        >
          <Pencil className="size-4" aria-hidden /> Change
        </button>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="mt-6 flex max-w-md flex-col gap-2">
      <label htmlFor={inputId} className="font-bold">
        Your first name
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          autoFocus
          autoComplete="given-name"
          onChange={(e) => setValue(e.target.value.slice(0, NAME_MAX))}
          className={field}
        />
        <button type="submit" className={cn(buttonStyles.primary, "min-h-12 shrink-0 px-5")}>
          Save
        </button>
      </div>
    </form>
  );
}

function NoteRow({ note, onSave, onRemove }: { note: string; onSave: (text: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(note);
  const inputId = React.useId();

  if (editing) {
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
            setEditing(false);
          }}
          className="flex flex-col gap-2 rounded-mini bg-paper p-2 ring-2 ring-ink sm:flex-row"
        >
          <label htmlFor={inputId} className="sr-only">
            Change this note
          </label>
          <input id={inputId} value={value} autoFocus maxLength={100} onChange={(e) => setValue(e.target.value)} className={field} />
          <div className="flex gap-2">
            <button type="submit" className={cn(buttonStyles.primary, "min-h-12 px-5")}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonStyles.quiet}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2 rounded-mini bg-paper py-1 pl-3 pr-1 ring-2 ring-line">
      <NotebookPen className="size-4 shrink-0 text-ink" aria-hidden />
      <p className="min-w-0 flex-1 py-2 leading-snug">{note}</p>
      <button
        type="button"
        onClick={() => {
          setValue(note);
          setEditing(true);
        }}
        aria-label={`Change note: ${note}`}
        className="press press-flat grid size-12 shrink-0 place-items-center rounded-full hover:bg-table"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove note: ${note}`}
        className="press press-flat grid size-12 shrink-0 place-items-center rounded-full hover:bg-table"
      >
        <X className="size-5" aria-hidden />
      </button>
    </li>
  );
}

/** A small "type and add" row; optional, since every other action here is tap-only. */
function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [value, setValue] = React.useState("");
  const inputId = React.useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onAdd(value);
        setValue("");
      }}
      className="mt-4 flex max-w-lg flex-col gap-2"
    >
      <label htmlFor={inputId} className="font-bold">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          maxLength={100}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className={field}
        />
        <button type="submit" aria-disabled={!value.trim()} className={cn(buttonStyles.primary, "min-h-12 shrink-0 px-5")}>
          <Plus className="size-4" aria-hidden /> Add
        </button>
      </div>
    </form>
  );
}
