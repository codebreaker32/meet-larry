# Larry: component handoff specs

_Written 30 Oct 2026 for the final build. It covers every component in `src/components/**`. Each spec follows the `/design-handoff` format: layout, tokens, props, variants, states, responsive behaviour, edge cases, motion and accessibility._

**Where this sits**
- `DESIGN.md` explains why things look the way they do (named rules, palette, type). This file says exactly how each component is built and how it behaves. When the two disagree, DESIGN.md wins: fix this file.
- `src/app/globals.css` holds the token values. The tables below name tokens, not values. Each value is given once, in section 1.
- The words Larry uses (titles, stages, moods, signals) are in `docs/glossary.md`.

**How to read a spec**
- **Status** is either **Ready** (all documented states built) or **Ready, with debt** (it works, but it still uses an old pattern listed in section 9; the owner named there fixes it).
- **States** list every state the component has. "n/a" means the state cannot happen, and the reason is given. A state that was missing in the audit and was added for this handoff is marked **(new)**.
- File paths are relative to `common-ground/src/`.

## Contents
1. [Foundations every component uses](#1-foundations-every-component-uses)
2. [Primitives (`components/ui/`)](#2-primitives-componentsui)
3. [The composer](#3-the-composer)
4. [Cards](#4-cards)
5. [Pickers, forms and flows](#5-pickers-forms-and-flows)
6. [Chrome, mascot and motion](#6-chrome-mascot-and-motion)
7. [Safety](#7-safety)
8. [Rooms (`components/room/`)](#8-rooms-componentsroom)
9. [Known debt and who fixes it](#9-known-debt-and-who-fixes-it)
10. [States added in this pass](#10-states-added-in-this-pass)

---

## 1. Foundations every component uses

### 1.1 Tokens (values live in `globals.css`)
Components use the Tailwind utility for each token. Primitive utilities such as `bg-paper` and `text-ink` resolve to the same values as the semantic roles (`bg-surface-raised`, `text-text-primary`). New code may use either form, but **never a hex value, an alpha border (`border-ink/15`), an arbitrary easing or a new `clamp()`**.

| Token (utility) | Value | Job |
|---|---|---|
| `--surface-page` (`bg-table`) | #f4f1ff | The page ground everywhere |
| `--surface-raised` (`bg-paper`) | #ffffff | Panels, cards, fields, person bubbles |
| `--surface-inverse` (`bg-ink`) | #14121f | Taste cards, Larry bubbles, primary buttons, pressed chips |
| `--surface-mat` (`bg-mat`) | #221d36 | Landing hero only |
| `--text-primary` (`text-ink`) | ink | All body text, 17:1 on the table |
| `--text-secondary` (`text-ink-soft`) | #4a4560 | Hints, meta, busy labels, 7.9:1 on the table |
| `--text-on-inverse` (`text-paper`) | paper | Text on ink |
| `--text-on-inverse-secondary` (`text-paper-soft`) | #c9c5da | Secondary text on ink and the mat. Never paper at reduced opacity |
| `--text-danger` (`text-danger`) | #b42318 | Error lines, 5.91:1 on the table |
| `--border-subtle` (`border-border-subtle`) | ink at 15% | Decoration only: chip edges, list rows (things known by their words) |
| `--border-subtle-inverse` | paper at 20% | The same on ink and the mat |
| `--border-control` (`border-border-control`) | #7d7896 | Text field and select edges, the hover edge of subtle chips. 3:1 or more (WCAG 1.4.11) |
| `--border-strong` (`border-ink`) | ink | Panels, pressed chips, secondary buttons |
| `line` (`border-line`, `bg-line`) | #ddd6f3 | The busy and disabled edge, skeleton fills, hairlines |
| `--scrim` (`backdrop:bg-scrim`) | ink at 60% | Behind every dialog |
| `--focus-ring` | #5a3fd6 | The focus outline on light grounds, 6:1 on the table |
| `--focus-ring-inverse` | #9d8bff | The focus outline on ink and the mat (switched automatically, see 1.4) |
| `--focus-width`, `--focus-offset` | 3px, 3px | Focus outline geometry |
| `--seat-1` … `--seat-5` (`SEAT_COLORS` in `lib/tokens.ts`) | film, music, players, books, tv | One colour per person. Always paired with a name or initial |
| `--cat-*` (through `DOMAIN_STYLE`) | 11 frame colours | Category frames, discs and markers. Always paired with an icon or label |
| `--button-h` | 3.5rem (56px) | Default button height |
| `--button-h-compact` | 3rem (48px) | Compact buttons, quiet buttons |
| `--field-h` | 3.5rem (56px) | Text fields and selects |
| `--chip-h` | 3rem (48px) | Chips, switches, segmented options |
| `--border-frame` | 3px | Category frames on posters and bridge cards |
| `--measure` (`max-w-measure`) | 52ch | The one reading width |
| `--dialog-sm`, `--dialog-md` (`max-w-dialog-sm`, `max-w-dialog-md`) | 28rem, 34rem | Confirmations, then forms and help |
| `--ease-deal` (`ease-deal`; `EASE_DEAL` in TS) | cubic-bezier(0.16, 1, 0.3, 1) | The one easing |
| `--dur-quick` (`duration-(--dur-quick)`; `DURATION.quick`) | 180ms | Colour swaps, morphs, press feedback |
| `--dur-base` (`DURATION.base`) | 250ms | Notes and banners in and out |
| `--dur-deal` (`DURATION.deal`) | 600ms | A card or stamp dealt onto the table |

**Radius:** `rounded-inner` 0.35rem (poster inner frames, logo), `rounded-tile` 0.6rem (posters), `rounded-badge` 0.85rem (stamps), `rounded-mini` 1.1rem (bridge cards, fields), `rounded-bubble` 1.25rem, `rounded-card` 1.4rem (taste cards), `rounded-panel` 1.75rem (panels, dialogs, composer), `rounded-full` (buttons, chips).

**Type:** `text-caption` 0.85rem/700 (the floor: nothing is smaller), `text-label` 0.95rem/700, `text-body` 1.0625rem, `text-lead` 1.15rem, `text-intro` 1.25rem, `text-title-sm` 1.45rem, `text-title-md` 2rem, `text-title-lg` 2.25rem, `text-step` 3rem, and three fluid roles: `text-display`, `text-title-page` and `text-title-session`. Anybody (`font-display`) sets names, headings and numerals only, at weight 900 (850 for title-md).

**Shadows:** `shadow-button`, `shadow-panel` (composer, panels, dialogs), `shadow-mini` (dealt bridge and place cards), `shadow-deal`, `shadow-card` (taste cards), `shadow-lift` (the composer on focus).

**Spacing:** the Tailwind 4px scale. Use `gap-2` (0.5rem) between related controls, 0.75rem for stacks, 1.5rem between sections and `p-4` or `p-5` inside panels. Targets are at least 48px with at least 8px between them.

### 1.2 Breakpoints
| Name | Query | What changes there |
|---|---|---|
| phone | under 640px (`max-sm:`) | Compact labels (`max-sm:text-label`), icon-only step pills, your own room bubble drops its tile |
| `min-[480px]` | 480px and up | Short one-tap replies go four to a row |
| `sm` | 640px and up | Rows sit side by side (forms, invite panel), dialogs gain side padding |
| `md` | 768px and up | The site header shows its links, and the phone Menu goes |
| `lg` | 1024px and up | Two-column sessions and rooms, larger bridge posters, "Questions for Larry" always open |
| short screens | height under 640px, and under 500px | The fixed composer and sticky header become static, so zoom and soft keyboards leave room to read |

### 1.3 State vocabulary (the same meaning everywhere)
| State | How it is built | Looks like |
|---|---|---|
| Rest | — | As specified per component |
| Hover | `hover:` | One step: ink fill goes ink-hover, paper goes table, and a subtle edge goes ink or `--border-control` |
| Press | `press` (+ `press-hard`, `press-soft` or `press-flat`) in globals.css | A hard-edge sink: the control drops by its edge while held and springs back over `--dur-quick`. No scale. Off while busy or disabled; nothing moves under reduced motion. Hand-rolled controls add the class themselves |
| Focus | Global `:focus-visible` outline | 3px `--focus-ring` at a 3px offset. It is an outline, not motion, so it stays under reduced motion and in forced colours |
| Pressed or checked | `aria-pressed`, `aria-checked` | Ink fill, paper text |
| **Busy** | `aria-disabled="true"` plus `aria-busy="true"`, a spinner before the label | Paper or table ground, `line` edge, ink-soft text, no shadow. The label stays. **Never the `disabled` attribute mid-conversation, and never opacity** |
| Disabled | `aria-disabled="true"` (still focusable, clicks ignored). Native `disabled` only on form fields | The same tone as busy, with no spinner |
| Error | A danger-text line, linked with `aria-describedby`; `aria-invalid` on the control; `role="alert"` when it appears after an action | Danger text, plus a danger edge on fields |
| Loading | `Skeleton` shapes (no pulse, no shimmer) inside one `role="status"` region that says what is loading, or a spinner and words | `line` shapes in the final layout |
| Empty | A dashed outline (never a grey fill) with one line saying what to do | — |
| Quiet | A tone change for Larry stepping back | A paper bubble, ink-soft text and a `line` ring |

### 1.4 Global accessibility rules
- **Focus:** the browser draws the global outline. On `.bg-ink`, `.bg-mat`, `.bg-surface-inverse` and `[data-surface="inverse"]` it switches to `--focus-ring-inverse`. A component may swap the outline for its own visible focus (the composer draws it on the whole box) but may never remove it.
- **Names:** icon-only buttons carry an `aria-label`, plus a tooltip where there is room. Decorative icons are `aria-hidden`.
- **Colour is never alone:** a category shows colour and icon, and a seat shows colour and name or initial (The Category Rule, The Seat Rule).
- **Announcements:** state changes that matter are said in a polite `role="status"` region. Errors after an action use `role="alert"`.
- **Reduced motion:** `globals.css` clamps every transition and animation to 0.01ms. framer-motion code also checks `useReducedMotion()`. Nothing that carries meaning depends on motion.
- **Copy:** easy-read, one or two short sentences, no "·", "×", "&" or arrows as joiners, positive first, Larry labelled an AI, and no emoji.

---

## 2. Primitives (`components/ui/`)
Import these from `@/components/ui`. The composer is the one exception: it is imported by file (section 3). These files are frozen after Stage 0, apart from the Stage 3 system owner.

### 2.1 Button, `buttonStyles`, `LinkButton`, `ButtonSpinner`
`ui/button.tsx`, `link-button.tsx`. **Status: Ready.**

**Overview:** the one button look. `Button` is the component. `buttonStyles` is the class map for the places that render their own `<button>`, `<a>` or `<Link>`. `LinkButton` is a Next `<Link>` in the same look, for navigation.

**Layout:** `inline-flex`, centred, `gap-2`, `px-6` (`px-4` for quiet and `sm`), `rounded-full`, `text-body` bold. The icon comes before the label at `size-5`.

**Tokens:** `bg-ink`, `hover:bg-ink-hover`, `text-paper` (primary); `border-2 border-ink`, `bg-paper`, `hover:bg-table` (secondary); `text-ink`, `hover:bg-paper` (quiet); `--button-h`, `--button-h-compact`; busy and disabled use `border-line`, `bg-paper` and `text-ink-soft`.

| Prop (`Button`) | Type | Default | Notes |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "quiet"` | `"primary"` | Use one primary per view where possible |
| `size` | `"md" \| "sm"` | `"md"` | md is 56px. sm is 48px, with label text on phones |
| `loading` | boolean | false | Spinner replaces the icon, `aria-busy`, clicks swallowed, label kept |
| `disabled` | boolean | false | `aria-disabled`, stays focusable, clicks swallowed. Never the HTML `disabled` attribute |
| `icon` | ReactNode | — | A Lucide icon, hidden from screen readers |
| `type` | button type | `"button"` | |
| …rest | button attributes | | `onClick` is not called while inert |

`LinkButton` takes `href`, `variant`, `className` and `children`. `ButtonSpinner` is the spinner slot for hand-rolled `buttonStyles` buttons: put it before the label and set `aria-disabled` and `aria-busy` on the button.

| Element | State | Behaviour |
|---|---|---|
| Primary | Rest, hover, press | Ink, then ink-hover (1px lift), then the `press` sink and a haptic tick (`haptic={false}` opts out) |
| Secondary | Rest, hover | Paper with an ink edge, then table |
| Quiet | Rest, hover | Text only, then a paper ground. 48px tall |
| Any | Focus | The global ring (inverse on ink grounds) |
| Any | Busy (`loading`) | The busy tone, a spinner (it turns only when motion is allowed), `cursor-progress`, label kept, width kept |
| Any | Disabled | The busy tone without a spinner, `cursor-not-allowed` |
| Any | Not ready yet | Secondary style, with the missing step written beside it as ink text ("Pick one step to save.") |

**Responsive:** `size="sm"` drops to label text under 640px. Buttons in sticky bars may go full width on phones (the caller sets `w-full`).
**Edge cases:** long labels wrap inside the pill, which grows taller (it has a min-height, not a fixed height). Never truncate a label. Busy keeps the label, so the width does not jump.
**Motion:** the `press` sink (globals.css), `--dur-quick` with `--ease-deal`; nothing moves under reduced motion.
**Accessibility:** a real `<button>` (a link only for navigation). Its name comes from the visible text. Icon-only buttons need an `aria-label`. Busy stays in the tab order, so focus never drops mid-conversation.

### 2.2 Chip, `chipStyles`
`ui/chip.tsx`. **Status: Ready.**

**Overview:** choice chips (speaker toggle, quick replies, category filter, the Plan Ticket's "When", moods) and plain action chips.
**Layout:** `min-h-(--chip-h)`, `px-4`, `gap-2`, `rounded-full`, `border-2`, `text-label` bold, `leading-tight`, an icon at `size-4` before the word.
**Tokens:** pressed `border-ink bg-ink text-paper`. Unpressed `border-border-subtle`, ground `bg-paper` (variant paper) or `bg-table` (variant table), `hover:border-ink`. Busy `border-line bg-table text-ink-soft`. Colour transition `duration-(--dur-quick)`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `pressed` | boolean | — | Given: a choice chip (`aria-pressed`). Left out: an action chip |
| `variant` | `"paper" \| "table"` | `"paper"` | Paper on the table, table inside a paper panel |
| `icon` | ReactNode | — | Never an icon alone |
| `busy` | boolean | false | `aria-disabled`, clicks ignored |

| State | Behaviour |
|---|---|
| Unpressed, hover | Subtle edge, then an ink edge |
| Pressed | Ink fill, paper text |
| Focus | Global ring |
| Busy or disabled | `aria-disabled` tone change, `cursor-not-allowed`, never a fade |

**Responsive:** chips wrap in a `flex-wrap gap-2` row and never scroll sideways. `max-w-full`, so a long word wraps inside the chip.
**Edge cases:** long labels wrap onto two lines, and the chip grows. Keep chip words short (one to four words).
**Accessibility:** `aria-pressed` for choices. Group related chips in a `role="group"` with a visible heading as the label. 48px targets.

### 2.3 Switch
`ui/switch.tsx`. **Status: Ready.**

**Overview:** an on/off setting: "Hidden gems only", "Show my check-ins to friends", "Plain words", and in future Ask Larry or Just us.
**Layout:** a 48px pill: icon, label, then a track (`h-6 w-10`) with a 16px knob, then the state word. With a `description`, a `flex-col gap-1.5` wrapper puts the description under the pill.
**Tokens:** off `bg-paper border-ink text-ink hover:bg-table`, track `border-ink bg-table`. On `bg-ink text-paper`, track `border-paper bg-paper`, knob ink. Busy or disabled: `bg-table border-line text-ink-soft`, track `border-ink-soft bg-paper`, knob `bg-ink-soft`. Motion: `duration-(--dur-quick)`, knob `ease-deal`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `checked` | boolean | required | |
| `onCheckedChange` | `(checked) => void` | required | Not called while busy or disabled |
| `label` | ReactNode | required | The setting, in words |
| `icon` | ReactNode | — | |
| `description` | ReactNode | — | Linked with `aria-describedby` |
| `stateWords` | `{on, off}` | `{on: "On", off: "Off"}` | Printed, so state is never colour or position alone |
| `busy` **(new)** | boolean | false | The change is being saved: `aria-disabled` and `aria-busy`, taps ignored |
| `disabled` **(new)** | boolean | false | Not available here: `aria-disabled`, focusable, taps ignored |
| `wrapperClassName` | string | — | |

| State | Behaviour |
|---|---|
| Off, hover | Paper pill, then a table ground |
| On | Ink pill, knob slides right, "On" printed |
| Focus | Global ring (inverse ring while on, because the pill is ink) |
| Busy **(new)** | Table ground, line edge, ink-soft words, ink-soft knob, `cursor-progress`. The state word stays |
| Disabled **(new)** | The same tone, `cursor-not-allowed` |

**Responsive:** `max-w-full`. The label wraps, and the track and state word stay on the right.
**Edge cases:** a change that alters results must be announced by the caller in a `role="status"` line ("Showing hidden gems only."). A failed save must flip `checked` back and show an error line under the switch.
**Motion:** the knob slides over `--dur-quick` with `ease-deal`; instant under reduced motion.
**Accessibility:** `role="switch"`, `aria-checked`. Space and Enter toggle (it is a native button). The visible label is its name.

### 2.4 Segmented
`ui/segmented.tsx`. **Status: Ready.**

**Overview:** pick exactly one of a few options: age ranges, the face scale, and the compact mood picker.
**Layout:** a visible label (`text-label` bold), then the options with `gap-2`: `layout="wrap"` (a wrapping row) or `layout="even"` (equal columns on one line). `size="md"` is a 48px pill with the icon beside the word. `size="lg"` is a 72px tile (`min-h-18`, `rounded-mini`) with the icon (28px) above the word.
**Tokens:** chosen `border-ink bg-ink text-paper`. Others `border-border-subtle bg-paper text-ink hover:border-ink`. In the error state, unchosen edges become `border-border-control`. Disabled: chosen `bg-ink-soft border-ink-soft` (paper words, 9:1), others `bg-table border-line text-ink-soft`. Colour transition `duration-(--dur-quick)`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | ReactNode | required | Printed as the group's heading unless `hideLabel` |
| `hideLabel` | boolean | false | Kept for screen readers |
| `options` | `{value, label, icon?}[]` | required | Every option has a word |
| `value` | `T \| null` | required | null: none chosen yet |
| `onChange` | `(value) => void` | required | |
| `layout` | `"wrap" \| "even"` | `"wrap"` | |
| `size` | `"md" \| "lg"` | `"md"` | |
| `error` **(new)** | ReactNode | — | A danger line under the group; `aria-invalid` and `aria-describedby` on the radiogroup |
| `disabled` **(new)** | boolean | false | `aria-disabled` on the group and each option. Choices are ignored, the chosen option stays visible |
| `className`, `labelClassName` | string | — | |

| State | Behaviour |
|---|---|
| None chosen | All options rest. The first option is the Tab stop |
| Chosen | Ink fill. The chosen option is the Tab stop |
| Hover | Ink edge on an unchosen option |
| Focus | Global ring. Arrow keys move and choose; Home and End jump to the ends |
| Error **(new)** | Danger line ("Pick the range you are in."), stronger edges on unchosen options |
| Disabled **(new)** | Arrows still move focus so every option can be read, but nothing is chosen. The chosen option shows as ink-soft |

**Responsive:** `wrap` wraps onto more rows at 320px. `even` keeps one row, so use it only for five or fewer short words (the face scale).
**Edge cases:** long words break inside the option (`break-words`). Keep option words short. With `value` not in `options`, nothing shows chosen.
**Accessibility:** `role="radiogroup"` labelled by the heading. Each option is `role="radio"` with `aria-checked`. One Tab stop, following the radio pattern.

### 2.5 Field, SelectField, `fieldStyles`
`ui/field.tsx`. **Status: Ready.**

**Overview:** every text field and select. `fieldStyles(size, className)` gives the control classes to inputs that are drawn by hand (the picker's search box, the access code).
**Layout:** a `flex-col gap-1.5` stack: label (`text-label` bold), control, hint (`text-label` ink-soft), then error (`text-label` bold danger). The control is `w-full`, `px-4`, `rounded-mini`, `border-2`, `text-body`.
**Tokens:** `bg-paper`, `border-border-control` (3:1 or more), `hover:border-ink`, `focus:border-ink` plus the global ring, `aria-invalid:border-danger`, `placeholder:text-ink-soft`, a coral caret (global). `--field-h` (md) or 48px (sm). Disabled: `bg-table border-line text-ink-soft`. Read-only (inputs only): `bg-table`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | ReactNode | required | Always printed unless `hideLabel` |
| `hideLabel` | boolean | false | |
| `hint` | ReactNode | — | Linked with `aria-describedby` |
| `error` | ReactNode | — | Linked, sets `aria-invalid` |
| `size` | `"sm" \| "md"` | `"md"` | sm only inside compact rows |
| `className` | string | — | The wrapper |
| `inputClassName` / `selectClassName` | string | — | The control |
| …rest | input or select attributes | | `id` is generated when missing |

| State | Behaviour |
|---|---|
| Rest | Paper, a `--border-control` edge |
| Hover | Ink edge |
| Focus | Ink edge plus the 3px ring |
| Error | Danger edge, danger line under the field, `aria-invalid="true"` |
| Disabled **(new)** | Table ground, line edge, ink-soft value (7.9:1), `cursor-not-allowed`. Leaves the tab order (the browser's rule). Use it only outside conversations |
| Read-only **(new)** | Table ground, stays focusable so the value can be selected and copied |
| Empty | The placeholder in ink-soft. The placeholder is an example, never the label |

**Responsive:** full width of its column. Side-by-side rows (`sm:flex-row`) stack on phones.
**Edge cases:** pass `maxLength` for capped fields (names 20, steps 140, messages 600) and show a "letters left" line near the cap. Error copy says what to do: "Codes look like LARRY-7KQ2MX. Check the letters with your friend." A one-time code field uses `inputMode="numeric"` and `autoComplete="one-time-code"`.
**Accessibility:** a real `<label for>`. Hint and error ids are joined with any `aria-describedby` passed in.

### 2.6 Dialog
`ui/dialog.tsx`. **Status: Ready.** Nine older dialogs still restyle a native `<dialog>` by hand; see section 9.

**Overview:** every modal: Help, Invite, Finish, Leave, Block and Report, the access code, Forget steps, Show this, and the coming check-in sheet.
**Layout:** a native `<dialog>` with `m-auto`, `w-[calc(100%-2rem)]` capped at `max-w-dialog-sm` or `max-w-dialog-md`, scrolling inside 85dvh. Inside there is `p-5`: a header row (title, then a Close button), the description (`mt-2`), then the content (`mt-4`).
**Tokens:** `bg-paper`, `border-2 border-ink`, `rounded-panel`, `shadow-panel`, `backdrop:bg-scrim`. Title `font-display text-title-sm`, weight 900. Close is `size-12`, `hover:bg-table`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `open` | boolean | required | Controlled |
| `onOpenChange` | `(open) => void` | required | Called with false on Escape, Close or a scrim tap |
| `title` | ReactNode | required | Always printed. It names the dialog |
| `icon` | ReactNode | — | A Lucide icon before the title |
| `description` | ReactNode | — | One or two sentences, linked with `aria-describedby` |
| `size` | `"sm" \| "md"` | `"md"` | sm for confirmations |
| `dismissible` | boolean | true | false: no Close button, and Escape and the scrim do nothing (a step that must be answered) |
| `onClosed` | `() => void` | — | After it closed, however it closed |
| `initialFocus` | `RefObject<HTMLElement>` | — | First focus on open: the safe choice ("Stay", "Keep them") or the field to fill. Default: the browser's first focusable, Close |

| State | Behaviour |
|---|---|
| Closed | Not rendered by the browser. Its content stays in the DOM, so tests should scope queries to the open dialog |
| Open | `showModal()`: focus moves inside, the page behind is inert |
| Closing | Focus returns to the trigger |
| Not dismissible | Escape is blocked at keydown, and a forced close reopens it |

**Responsive:** 1rem from each edge on phones. Long content scrolls inside the panel, and the header scrolls with it.
**Edge cases:** content taller than `--dialog-max-h` (85dvh) scrolls. Put a sticky action row inside the content if the main action must stay in reach.
**Motion:** none. It appears and goes at once (a dialog is not a dealt card).
**Accessibility:** `aria-labelledby` (title) and `aria-describedby` (description). The browser traps focus. Close is labelled "Close". Escape closes.

### 2.7 Skeleton, SkeletonGroup
`ui/skeleton.tsx`. **Status: Ready.**

**Overview:** loading placeholders in the shape of what is coming.
**Layout:** `block shrink-0`, sized at the call site (`h-4 w-2/3`).

| Prop | Type | Default | Notes |
|---|---|---|---|
| `shape` (`Skeleton`) | `"bar" \| "block" \| "circle" \| "slot"` | `"bar"` | bar: a 16px text line. block: a poster or tile (`rounded-tile`). circle: an avatar. slot: a dashed outline for an empty card slot |
| `label` (`SkeletonGroup`) | string | required | What is loading, read once ("Finding your common ground.") |

**Tokens:** `bg-line`, or for slot `border-2 border-dashed border-line`.
**States:** loading only. When the data lands, replace the skeleton with the content in the same box, so nothing jumps.
**Motion:** none. No pulse and no shimmer (DESIGN.md).
**Accessibility:** shapes are `aria-hidden`. `SkeletonGroup` is `role="status"` with an `sr-only` label. When a visible status line already says it ("Asking Qloo what your cards share…"), the shapes can sit in a plain `aria-hidden` list instead.

### 2.8 Badge
`ui/badge.tsx`. **Status: Ready.**

**Overview:** a small marker that is not a control: "Best fit", "Demo visit", "Guest account", "Made-up character", "Rising in Mumbai".
**Layout:** `inline-flex gap-1`, `whitespace-nowrap`, `rounded-full`, `text-caption` bold. sm is `px-2 py-0.5`, md is `min-h-8 px-3`. Icon `size-3.5`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `"ink" \| "paper" \| "outline"` | `"ink"` | ink: the one strongest marker on a card. paper: a 2px ink ring. outline: a subtle ring and ink-soft text |
| `size` | `"sm" \| "md"` | `"sm"` | |
| `icon` | ReactNode | — | |

**States:** static. n/a for hover, focus and disabled, because it is never a target.
**Edge cases:** `whitespace-nowrap`, so keep badge words to three words or fewer. In a narrow card row, let the row wrap rather than the badge.
**Accessibility:** a `span` with its full text. Never colour alone, never an icon alone.

### 2.9 Stamp
`ui/stamp.tsx`. **Status: Ready.**

**Overview:** the earned mark: "Done" on First Steps, and the base of every title badge.
**Layout:** `inline-flex`, `rounded-badge`: icon, then word and optional detail stacked, then pips (`size-2` dots, `gap-1`). sm is `px-2.5 py-1` with caption text. md is `px-3 py-1.5` with label text.
**Tokens:** outline `border-2 border-ink bg-paper text-ink`. Solid `bg-ink text-paper`, with detail in `text-paper-soft`. Done: `border-(length:--border-frame) border-cat-games-ink`, `text-cat-games-ink`, Anybody 900, uppercase (the one exception), turned -4deg.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `"outline" \| "solid" \| "done"` | `"outline"` | Solid is the stronger form of the same mark |
| `size` | `"sm" \| "md"` | `"md"` | |
| `icon` | ReactNode | — | Lucide, from the title registry |
| `pips`, `pipsMax` | number, number | —, 5 | Read as "3 of 5" |
| `pipsLabel` | string | — | A better reading ("3 of 5 visits to Veteran") |
| `detail` | ReactNode | — | "at Café Condi", "2 visits away" |
| `fresh` **(new)** | boolean | false | Just earned: dealt in once |

| State | Behaviour |
|---|---|
| Static | At rest |
| Fresh **(new)** | On first render, it lifts 0.5rem, turns -6deg and scales to 0.9, then settles over `--dur-deal` with `ease-deal` (through CSS `@starting-style`, so later renders never replay it). Transform only: the word is readable from the first frame. The caller announces the gain in a polite status line |

**Edge cases:** pips are clamped to 0…`pipsMax`. A long detail wraps under the word (`max-w-full`).
**Accessibility:** the word is always printed and the icon is hidden. Pips have an `sr-only` reading. No metal colours, no foil.

### 2.10 ChatBubble
`ui/chat-bubble.tsx`. **Status: Ready.** The only chat bubble: the pair page, Talk taste (`app/larry/page.tsx`) and rooms (`live-room.tsx`) all render it.

**Overview:** one chat bubble for Larry and for people.
**Layout:** `flex items-end gap-2`: avatar (36px), then a column (`max-w-[85%]`, 80% from `sm`) with the name line, the bubble and an optional footer. `align="end"` reverses the row.
**Tokens:** Larry `bg-ink text-paper`; quiet Larry `bg-paper text-ink-soft ring-2 ring-line`; a person `bg-paper text-ink ring-2`, with the ring in `seatColor` (ink when there is none). `rounded-bubble`, `px-4 py-2.5`, `text-body leading-snug`. Initial tile `size-9 rounded-tile` in the seat colour, Anybody caption.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `sender` | `"larry" \| "person"` | required | |
| `name` | string | — | Ignored for Larry |
| `initial` | string | the name | The tile letter when the name line says something else ("You" in a room) |
| `seatColor` | CSS colour | — | Use a token: `var(--seat-1)` |
| `align` | `"start" \| "end"` | `"start"` | end: this phone's person, or seat a |
| `quiet` | boolean | false | Larry stepped back |
| `excused` | boolean | false | Adds ", not seen by Larry" |
| `practice` | boolean | false | Adds "(practice character)" |
| `toLarry` | boolean | false | Adds ", to Larry" |
| `showName` | boolean | true | false keeps the name for screen readers only (later messages in a run) |
| `avatar` | `"show" \| "hide-on-phone"` | `"show"` | |
| `footer` | ReactNode | — | "Sending…", what Larry just did |

| State | Behaviour |
|---|---|
| Default | As above |
| Quiet | Tone change only, never opacity. The avatar ring goes `line` |
| Excused | The name line says it was not seen by Larry |
| Sending | Pass `footer="Sending…"` (ink-soft caption) |
| Failed to send | Pass a footer in danger text with a retry button, or show the page-level error. The bubble itself stays readable |

**Responsive:** under 640px, `avatar="hide-on-phone"` drops the tile on your own lines.
**Edge cases:** `whitespace-pre-line` keeps line breaks. Long words break normally. A missing name reads "Someone".
**Accessibility:** Larry is always named "Larry (AI pal)". The list containing the bubbles is a polite live region (the page's job). Avatars and tiles are hidden; the name line carries who it is.

### 2.11 FaceScale, FaceMark, `FACES`, `faceWord`
`ui/face-scale.tsx`. **Status: Ready.**

**Overview:** five faces with words (Awful, Not great, OK, Good, Great) for "How do you think it'll go?" and "How did it go?".
**Layout:** `FaceScale` is `Segmented` with `layout="even" size="lg"`: five equal 72px tiles. `FaceMark` is an icon (32px) over a word (Anybody title-sm).
**Props:** `FaceScale` takes `label`, `hideLabel`, `value` (1 to 5, or null), `onChange`, `className` and `labelClassName`. `FaceMark` takes `value`.
**States:** none chosen, chosen, focus (from Segmented). `FaceScale` does not pass on Segmented's `error` and `disabled` yet. Add the two props if a flow ever needs them; the guess is always optional today, so it has no error.
**Edge cases:** at 320px, "Not great" wraps onto two lines inside its tile. Never colour-coded. Show the Guess vs Reality line only when reality met or beat the guess.
**Accessibility:** a radiogroup with the question as its heading. Words are always printed.

---

## 3. The composer
### 3.1 PromptInputBox (with PromptInput, FloatingNote and the tooltip)
`ui/ai-prompt-box.tsx`. **Status: Ready.** Used by the pair session, Talk taste and live rooms.

**Overview:** where people type or speak. It holds who is talking, Ask Larry or Just us, Excuse or Hello Larry, one-tap replies, questions for Larry, and the one action button that morphs between mic, stop and send.
**Layout (top to bottom):** two floating notes above the box (absolute, they never push the chat); the excused banner or the mode row; "Questions for Larry" (a 2-column grid in a fieldset); the replies fieldset; then the composer box. The box holds the "Who is talking?" row (hidden with one speaker), the listening line, a textarea plus a 48px action button, a "letters left" line, an unsupported-voice line and a speech error line.
**Tokens:** box `rounded-panel border-2 border-ink bg-paper p-2 shadow-panel`. Focus: `outline-3 outline-offset-2 outline-focus-ring` on the whole box, plus a lift (`-translate-y-1.5`, `shadow-lift`, `duration-(--dur-quick)`). Chips are 48px with `border-border-subtle` and `hover:border-border-control`. Pressed is ink. Listening: `border-film` box, and a coral stop button. The banner is `bg-ink text-paper rounded-bubble`. Notes are `bg-paper border-2 border-ink rounded-bubble shadow-panel`. The tooltip is `bg-ink text-paper rounded-tile shadow-mini`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `speakers` | `{name, color}[]` | required | One speaker hides "Who is talking?" |
| `activeSpeaker`, `onSpeakerChange` | number, fn | required | |
| `onSend` | `(message, toLarry) => void` | required | `toLarry` is false for Just us and while excused |
| `replies` | string[] | [] | Said by the speaker to `replyTo` |
| `replyTo` | string | — | |
| `larryQuestions` | string[] | [] | Their own group. A tap always asks Larry |
| `mode`, `onModeChange` | `"larry" \| "us"` | — | Left out (practice), everything goes to the chat partner |
| `isLoading` | boolean | false | Larry is replying: sending waits |
| `disabled` | boolean | false | Everything waits, and the textarea is disabled |
| `larryBusy` | boolean | false | Rooms: only messages to Larry wait |
| `placeholder`, `repliesLabel` | string | — | Single-speaker wording |
| `repliesHighlight` | boolean | false | Ink frame: someone is waiting for this person's answer |
| `away`, `onAwayChange` | boolean, fn | false | Excuse Larry and Hello Larry |
| `justUsNote` | string | — | Shown once per device |

| Element | State | Behaviour |
|---|---|---|
| Box | Idle | Paper, ink edge |
| Box | Focus (keyboard) | 3px focus ring around the whole box at a 2px offset; the lift and shadow are extras. The lift goes under reduced motion, the ring stays |
| Box | Listening | Coral edge, a "Listening to Sam. Tap stop when you are done." line with a pinging dot (motion-safe) |
| Action | Mic | Table ground, subtle edge, label "Speak instead of typing" |
| Action | Send | Ink, label "Send to Larry" or "Send to Priya" |
| Action | Stop | Coral fill, ink square icon |
| Action | Busy | `aria-disabled`, line edge, table ground, label "Wait for the reply". Stays mounted and focused |
| Replies and questions | Busy | `aria-disabled` tone change. The seat-colour frame is dropped |
| Mode row | Ask Larry or Just us | `aria-pressed` pair. The first Just us on a device shows the one-time note (7s, or until "Got it") |
| Banner | Excused | "Larry stepped out. It can't see this chat." and Hello Larry. Focus moves to Hello after Excuse, and back to Excuse after Hello |
| Note | Larry's back | "Larry's back. Ask away!" for 4s |
| Text | Near the cap | Under 80 letters left: "N letters left" (polite) |
| Text | Error | Speech error in danger text, `role="alert"` |
| Text | Voice unsupported | "Voice typing works in Chrome, Edge or Safari." |
| Crisis words | Any mode | Never wait for Larry: they get the fixed help reply with no model call (the page handles the reply) |

**Responsive:** questions sit behind a "Questions" toggle under 1024px and are always open from `lg`. Replies of 7 letters or fewer go four to a row. Replies of 12 or fewer go two to a row, and four from 480px. Longer replies wrap as chips. Chip padding and icons shrink under 640px. The page makes the composer fixed on phones and static below 640px of height.
**Edge cases:** messages are capped at 600 letters (`MESSAGE_MAX`). Pasted text is cut to the cap. A late speech result never refills the box after sending. Enter sends, and Shift+Enter adds a line.
**Motion:** floating notes rise 8px and fade in over `DURATION.base` with `EASE_DEAL`. The action icon swaps scale and fade over `DURATION.quick`. The listening line opens its height over `DURATION.base`. All of it snaps under reduced motion.
**Accessibility:** the textarea has an `sr-only` label ("Message from Sam"). The action button is always the same element, named by its current job, with a tooltip. Groups: "Who hears your message?", "Who is talking?", "Priya's replies", "Questions for Larry". The excused state is announced in a status region.

---

## 4. Cards

### 4.1 TasteCard, Poster
`taste-card.tsx`. **Status: Ready, with debt** (alpha borders inside, unused `VenueCard`).

**Overview:** your taste as a trading card: an ink face, a name, a 3 by 2 poster grid, a category icon row and the foil edge. `Poster` is one window: Qloo art, or a card back with the category icon and the title.
**Layout:** `aspect-[5/7]`, `flex-col`, `rounded-card`. lg is 20rem wide with `p-4`, md 15rem with `p-3`, sm 9.5rem with `p-2.5`, and xs 6.5rem with `p-2`. Then a name row (Anybody 850 plus a seat or accent dot), a grid (`grid-cols-3 grid-rows-2`, `gap-2`, or `gap-1` for sm and xs) and the icon row (`size-7` discs for lg, `size-6` for the rest).
**Tokens:** `bg-ink text-paper shadow-card`, `.foil`. Poster: `rounded-tile`, a frame in the category colour (`DOMAIN_STYLE[d].color`), and the fallback ground is the category colour (Games uses `--cat-games-tint`).

| Prop (`TasteCard`) | Type | Default | Notes |
|---|---|---|---|
| `profile` | `Profile` | required | Name and items |
| `accent` | CSS colour | `var(--film)` | The dot beside the name (a seat colour in rooms) |
| `size` | `"lg" \| "md" \| "sm" \| "xs"` | `"lg"` | xs hides the icon row (read out only) |
| `fit` | boolean | false | Only the picks, with no empty slots (example cards) |
| `total` | number | — | All picks, when the persona holds more than the card |
| `footer` | ReactNode | — | Right end of the icon row |
| `className`, `style` | | | |

`Poster` takes `item`, `className` and `sizes` (default "120px").

| Element | State | Behaviour |
|---|---|---|
| Slot | Filled | Qloo art (`object-cover`) |
| Slot | No art | A card back: the category colour, an inner frame, the icon and the title. The title shows only when its longest word fits, measured, so words never break. Otherwise the icon shows alone |
| Slot | **Art failed to load (new)** | Falls back to the same card back (the failed address is remembered per item), never a broken-image icon |
| Slot | Empty | A dashed outline (`border-dashed border-border-subtle-inverse`) |
| Slot | More than 6 picks | The last slot reads "+N more" |
| Card | Hover (pointer) | The foil sheen follows the pointer on the frame edge |
| Card | Loading | n/a: cards are drawn from data on the device. Pages waiting on storage keep the card's box empty, at its size |

**Responsive:** fixed widths per size. Fallback titles use container queries (`@[3.75rem]` to `@[8.75rem]`) by the longest word.
**Edge cases:** a long name truncates on one line (`truncate`) and is read in full. Icons that do not fit the row are dropped from view but all are read out.
**Motion:** foil follows the pointer (no transition). Off on touch.
**Accessibility:** the name is an `h3` labelled "Sam's taste card". Each poster has an `sr-only` "Film: Spirited Away". The icon row reads "Likes Film, Music…".

`VenueCard` was deleted; `PlaceCard` is the one place card.

### 4.2 BridgeCard, BridgeCardSkeleton and helpers
`bridge-card.tsx`. **Status: Ready.** One card for pairs and rooms (the old `GroupBridgeCard` is merged into it).

**Overview:** one piece of common ground dealt between 2 to 5 people: poster, category, name, Larry's reason, one easy-read line per pick with a seat marker for each person behind it, and "Why this?".
**Layout:** `flex gap-3 p-2.5 rounded-mini`, a `--border-frame` frame in the category colour. Poster 3.5 by 5rem (4.4 by 6rem from `lg`). The text column holds a category row (icon, label, `Badge` "Best fit"), the name (Anybody 900, body), Larry's reason (body bold), reason lines (label, with `SeatMarks`: one `h-3 w-1.5` seat-colour bar per person, or one ink bar), then "Why this?".
**Tokens:** `bg-paper shadow-mini`, frame `DOMAIN_STYLE[d].color`, `Badge variant="ink"`, why panel `bg-table rounded-tile p-2.5`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `bridge` | `Bridge \| GroupBridge` | required | A pair bridge (`fromA`, `fromB`) or a group bridge (`from` by member id) |
| `people` | `Seat[]` (`{ id, name, color }`) | required | 2 to 5 people. For a pair bridge, seat a then seat b. Room members pass as they are |
| `best` | boolean | false | Only the first card in fit order |

Helpers: `bridgeLines`, `bridgeReason`, `whyText` (pairs), `groupBridgeLines` (rooms, in `room-utils.ts`) and `cleanWhy` give the easy-read text, tested. `SeatMarks` is exported for `SharedPickCard`.

| Element | State | Behaviour |
|---|---|---|
| Card | Default | As above |
| Card | Best fit | An ink "Best fit" badge at the right of the category row. No percentages |
| Card | **Loading (new): `BridgeCardSkeleton`** | The same frame in `line`, a block poster and four bar lines, at least 8.5rem tall, still, `aria-hidden`. Pair it with a status line ("Asking Qloo what your cards share…") |
| Card | No Larry reason | The reason line is left out; the Qloo lines still show |
| Why this? | Closed, open | `aria-expanded`; the chevron turns 180 degrees; the panel is `hidden` when closed |

**Responsive:** bigger poster from `lg`. Reason lines wrap and are never truncated.
**Edge cases:** no picks behind it gives "Fits both your tastes." (pair) or "Fits your group's tastes." (room). "You both like" lines carry both seat bars. A title ending in "." gets no second full stop. Two picks at most per person. Names are joined as "Sam, Priya and Alex"; a member who left drops out of the lines.
**Accessibility:** an `article` with an `h3` name. Seat bars are hidden; the line says the name. "Why this?" is a 48px button with `aria-controls`.

### 4.3 SharedPickCard
`room/shared-pick-card.tsx`. **Status: Ready.** (Group bridges use `BridgeCard` with `people={members}`.)

**Overview:** something two or more people in a room both picked, as a small dealt card.
**Layout and tokens:** the `BridgeCard` box with an ink `--border-frame` frame, the poster, the name (Anybody 900) and one line with `SeatMarks` for the people who picked it.
**Props:** `item`, `memberIds` and `members`.
**States:** static. Everyone picked it: "You all picked this."
**Accessibility:** as `BridgeCard`.

### 4.4 PlaceCard, VibeChip, `fitLine`
`place-card.tsx`. **Status: Ready.**

**Overview:** a real place: Qloo photo, name, vibe chip, distance, tags, hours, one fit line per person, a "Why this place?" disclosure and an action.
**Layout:** `flex gap-3 p-2.5 rounded-mini border-2 border-ink`. md is a row (photo `w-24`, or `w-28` from `sm`, at least 6rem tall, on the left). lg is a column (photo `h-40`, or `h-48` from `sm`, on top; a 3.5rem strip when there is no photo).
**Tokens:** `bg-paper shadow-mini`. Photo well `bg-table rounded-tile`. Fallback is a dashed `border-ink/25` frame with a `MapPin`. Chips are `bg-table rounded-full text-caption` bold. VibeChip is `bg-paper ring-2 ring-ink`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `place` | `Place \| PlaceCard` | required | |
| `people` | `Record<id, {name, color}>` | — | Fit lines for listed people only |
| `action` | ReactNode | — | "Plan this", "Add" |
| `size` | `"md" \| "lg"` | `"md"` | |
| `meet` | boolean | false | Shows "Open to meet here" (18+, mutual, only while there) |

| Element | State | Behaviour |
|---|---|---|
| Photo | Present | Qloo image (only `images.qloo.com/i/` passes) |
| Photo | Missing | A dashed frame with a map pin |
| Photo | **Failed to load (new)** | The same dashed frame (the failed address is remembered) |
| Fit lines | None | Falls back to `place.reason` |
| Why this place? | Closed, open | Native `<details>`, a 48px summary |

**Responsive:** lg photo is taller from `sm`. Chips wrap.
**Edge cases:** at most 3 tags, with the vibe word left out of the tags. Likelihood is in words ("maybe, it can get busy"), never colour. Unknown hours: no hours line.
**Accessibility:** an `article` with an `h3`. `sr-only` full stops separate the chips for screen readers. "Opening hours:" is said before the hours.

### 4.5 PlanTicketView
`plan-ticket.tsx`. **Status: Ready, with debt.** Spec additions for the final build (if-then stub, guess, six obstacles, variants) are in `research/component-specs.md` section 5 and belong to 2E.

**Overview:** the one real plan a session ends on: the place (`PlaceCard lg`), When chips, What to do, Bring up, "Say this, or show it" with `ShowThis`, plan B for a worry, and "I'll do it".
**Layout:** one column. `variant="panel"`: `rounded-panel border-2 border-ink bg-paper p-4 shadow-panel`, scrolling inside `--panel-max-h`, with a sticky commit bar (`border-t-2 border-line`). `variant="dialog"`: unframed, inside a `Dialog`.
**Tokens:** chips at 48px (`border-border-subtle`, pressed ink). Opener `bg-table rounded-mini p-3 text-title-sm` bold. Plan B box `border-2 border-ink bg-paper p-3`. Bring up has a frame in the item's category colour.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `ticket` | `PlanTicket` | required | |
| `people` | FitPeople | — | |
| `withPerson`, `ownerName` | string | — | |
| `variant` | `"panel" \| "dialog"` | `"panel"` | dialog: unframed inside a `Dialog` (room Finish) |
| `afterSave` | `"share" \| "close"` | `"share"` | share: show `ShareStep` (one shared phone, the pair session). close: solo chats and rooms |
| `onOther`, `onCancel`, `onSaved` | fn | — | Other ideas, Keep talking, after a save |
| `onDone` | fn | required | |
| `autoFocus` | boolean | true | Focus "Your plan" on open |
| `location`, `picks` | | — | For the "I can't get there" plan B search |

| State | Behaviour |
|---|---|
| Draft | Everything is tappable. The first When chip is chosen |
| Hours unknown | "Daytime only. We don't know this place's hours, so check the door first." |
| **No daytime time (new)** | No When chips (the group is hidden). "This place isn't open in the daytime soon. Tap Other ideas for another place." Times are never invented |
| Plan B asked | Fixed line at once, then "Larry is finding a better plan B…" with a spinner until Larry's line replaces it. The fixed line stays if Larry fails |
| **Save failed (new)** | Storage refused (private browsing, a full phone): "Hmm, that didn't save. Try again in a moment?" in danger text, `role="alert"`, replacing "A plan, not a booking." The button can be tapped again |
| Saved, `afterSave="share"` | `ShareStep` with the plan's QR and link |
| Saved, `afterSave="close"` | "Saved to your First Steps" with See my First Steps and Done. Focus moves to the heading |

**Responsive:** obstacle chips are one column on phones and two from `sm`. The sticky bar wraps.
**Edge cases:** saving twice is blocked by a ref. The plan B result is cached per worry. The opener is shown large.
**Motion:** none apart from the spinner.
**Accessibility:** a `section` labelled by its heading. When and the worries are labelled groups of `aria-pressed` buttons. Plan B is a status region. Focus moves to the heading on open and after saving.

### 4.6 ShareStep
`share-step.tsx`. **Status: Ready.**

**Overview:** after saving, the plan travels as a QR code on a card back plus a share link, so the other person keeps it on their own phone.
**Layout:** a panel (`rounded-panel border-2 border-ink bg-paper p-4 shadow-panel`, `--share-max-h`): the heading, a line, an optional step picker, then a QR card (`w-52`, ink, foil, the QR on paper) beside the step text, the note, "Send as a link" and the copy status. Done sits at the end.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `steps` | `DraftStep[]` | required | More than one shows a picker |
| `withPerson`, `ownerName` | string | — | |
| `headingRef` | ref | required | The caller focuses it |
| `onDone` | fn | required | |
| `title`, `note` | | — | |
| `cardLabel` | string | `"First Step"` | Under the QR |

| Element | State | Behaviour |
|---|---|---|
| QR | **Loading (new)** | A block skeleton in the QR square, in a status region that says "Making the QR code." |
| QR | Ready | The image, alt `QR code to save "<step>"` |
| QR | **Failed (new)** | "The QR code didn't load. Send it as a link instead." printed in the square |
| Link | Copied | "Link copied." (status) |
| Link | Share sheet closed | Nothing happens (not an error) |
| Link | Copy failed | Danger line and a read-only field holding the link, which selects itself on focus |

**Responsive:** the QR card sits above the text on phones and beside it from `sm`.
**Accessibility:** a `section` labelled by the heading. The step picker is a labelled group of `aria-pressed` buttons.

### 4.7 ShowThis
`show-this.tsx` (added during the final build for persona walkthrough finding R7). **Status: Ready.**

**Overview:** "Show it instead": the opener as a big card the person can turn round and show, so nobody has to say it out loud.
**Layout:** a secondary `min-h-12` button ("Show it instead", `Smartphone` icon) that opens a `Dialog` titled "Show this": the poster (`h-40 w-28`), the line (Anybody `text-title-md` 900, centred) and a full-width Done.
**Props:** `line` (string, required), `item` (TasteItem, optional) and `className`.
**States:** closed, open. Nothing is sent or read aloud.
**Edge cases:** a long opener wraps; the dialog scrolls inside `--dialog-max-h`. The closed dialog's text stays in the DOM, so e2e tests must scope to the open dialog or to the visible line.
**Accessibility:** the Dialog primitive (named by its title, described by "Turn the phone round so they can read it.").

### 4.8 StepKindPill, `STEP_KIND`
`step-kind.tsx`. **Status: Ready.**

**Overview:** the kind of a First Step (Go, Say, Show), always neutral.
**Layout:** `inline-flex min-h-8 gap-1.5 px-2.5 rounded-full`: a `size-4` icon and the word in label bold. Compact: icon only under 640px (`size-9`, centred).
**Tokens:** `bg-paper ring-2 ring-ink text-ink`.
**Props:** `kind`, `variant` (`"full"`, default, or `"compact"`), `decorative` (hidden from screen readers when the kind is already read with the step) and `className`.
**States:** static.
**Accessibility:** the word stays in `sr-only` when compact. A trailing `sr-only` full stop separates it from the step text.

### 4.9 MemberCard, EmptySeat, MemberRow
`room/member-card.tsx`. **Status: Ready.**

**Overview:** each room member's taste card at table size, then the free seats.
**Layout:** `aspect-[5/7] w-[6.75rem] p-2 rounded-mini`: a name row (seat dot and name), "You" or a blank, then a 2 by 2 poster grid. A `--border-frame` ring in the seat colour, offset 2px. `EmptySeat` is the same box, dashed `border-ink-soft`, with "Free seat" and a `UserPlus` icon on the first one. `MemberRow` scrolls sideways on phones (`-mx-4 overflow-x-auto`) and wraps from `lg`.
**Props:** `MemberCard` takes `member`, `isMe` and `className`. `EmptySeat` takes `first`. `MemberRow` takes `members`, `meId`, `seats` (default 5) and `className`.
**States:** default, me, empty seat, empty poster slot (dashed).
**Edge cases:** long names truncate and are read in full. An Open to meet room passes `seats={2}` and shows no free seats.
**Accessibility:** the list is labelled "3 of 5 people in the room". Each card has an `sr-only` "You. Likes …". Empty seats are hidden.

---

## 5. Pickers, forms and flows

### 5.1 PicturePicker, Thumb, NameField
`picture-picker.tsx`. **Status: Ready.**

**Overview:** a picture-first taste picker over every Qloo category, with search and voice. `NameField` is the first-name field with a mic.
**Layout:** a `flex-col gap-5` stack: your picks (removable pill buttons with a `Thumb`), the category chips (wrap), sport filter chips (Sports and Players only), a starter tile grid (3 columns, 4 from `sm`, `aspect-[3/4]` tiles), the search field with a clear button and a mic, then results.
**Tokens:** the category chip disc uses the category colour plus its icon. Chips `border-border-subtle`, `hover:border-border-control`, pressed ink. Search and name inputs use `fieldStyles` (a `--border-control` edge, an ink edge on focus and the global ring). Tiles have a `--border-frame` frame (ink when picked) and a check badge `bg-ink ring-2 ring-paper`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `selected` | `TasteItem[]` | required | |
| `onChange` | fn | required | |
| `max` | number | — | No cap in the app; quick cards pass 10 |

`NameField` takes `id`, `value`, `onChange`, `hint` and `placeholder` (capped at 20 letters).

| Element | State | Behaviour |
|---|---|---|
| Picks | Empty | Dashed box: "Nothing yet. Tap pictures below to add them." |
| Picks | Full (`max` reached) | "That's the most for here. Tap a picture above to take it off." Tapping a new tile moves focus to the first pick. Only the tile image fades (`opacity-50 grayscale`), never the name |
| Tile | Picked | Ink frame, check badge, `aria-pressed` |
| Search | Loading | "Looking…" with a spinner, after a 300ms pause in typing |
| Search | Empty result | "Nothing found. Try a shorter name, or tap a picture above." |
| Search | **Error (new: retry)** | "Search isn't working right now. The pictures above still work." plus a 48px "Try again" button that searches the same words again |
| Mic | Listening | Ink button, `MicOff` icon, label "Stop listening" |
| Mic | Error | Danger line, `role="alert"`, linked to the field |
| Thumb | **Art failed (new)** | The category icon on its colour |

**Responsive:** chips wrap onto two rows on phones, so no category hides.
**Edge cases:** speech fills the search box (capped at 80 letters). Requests are aborted when the words change. More than 10 picks: "Your card shows the first 10."
**Accessibility:** a polite `sr-only` status says what changed ("Added Spirited Away. 3 picked."). Pick pills are named "Remove <name>". Groups are "What kind of thing?" and "Which sport?".

### 5.2 QuickCard
`room/quick-card.tsx`. **Status: Ready.**

**Overview:** the short way to a card inside the room flow: at least 3 pictures, a first name, done.
**Layout:** an intro line (46ch), `PicturePicker` (max 10), `NameField`, and a sticky bottom bar (`border-t-2 border-ink bg-paper`) with the count, the missing step and the action.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `action` | string | required | "Save and join" |
| `busy` | boolean | false | Joining |
| `onReady` | `(profile) => void` | required | |

| State | Behaviour |
|---|---|
| Not ready | The primary button in the shared not-ready style (`aria-disabled`: paper, line edge, ink-soft words), with the missing step under the count ("Pick 2 more.", "Add your first name."). A tap with picks done moves focus to the name |
| Ready | Primary button with an arrow |
| Busy | `<Button loading>`: spinner, `aria-disabled` and `aria-busy`, taps ignored |

**Responsive:** the bar runs edge to edge (`-mx-4`, or `-mx-5` from `sm`). Label text on phones.

### 5.3 AccessCodeForm, AccessCodePrompt, AccessCodePageBody
`access-code.tsx`. **Status: Ready.** The prompt is the `Dialog` primitive (md).

**Overview:** type an access code once. It is checked on the server and kept on this phone. The prompt opens by itself when an AI route answers 401 or 402.
**Layout:** a form (`max-w-md`, `gap-3`): a saved-code row with Remove it, the label, a hint, then the input and Save code (side by side from `sm`), then a status line. The prompt is a `Dialog` (`size="md"`) with the state's title and line as its description, the form and a "No code?" line. The code field has first focus (`initialFocus`, through the form's `inputRef`).
**Tokens:** the input uses `fieldStyles("md")` with lead text, uppercase (the placeholder stays normal case). The button is primary.

| State | Behaviour |
|---|---|
| Rest | Empty field, hint "It looks like LARRY-…" |
| Checking | "Checking…", spinner, `aria-disabled` and `aria-busy` with the shared busy tone **(new: was a one-off override)** |
| Invalid | The server's error in danger text, `aria-invalid` and a danger edge on the field **(new edge)** |
| Network error | "Couldn't check the code right now. Try again in a minute." |
| Saved | "Code saved on this phone." plus how much AI time is left, in words |
| Prompt states | missing: "Larry's AI needs a code". invalid: "That code didn't work". spent: "This code has used its AI time". Then "Code saved" with Okay |

**Accessibility:** the hint and status are linked with `aria-describedby`. The status is polite. Focus goes to the field in the prompt.

### 5.4 EndPanel, StepChoice, `useAiSteps`
`pair/end-panel.tsx`. **Status: Ready.**

**Overview:** the end of a session: pick or write one real First Step, save it, then hand over the QR code (`ShareStep`).
**Layout:** a panel (`--panel-max-h`, `p-4`): heading, intro, list of choices (`StepChoice`: kind pill, text, check circle), a "Write your own step" disclosure (dashed until open), then a sticky action bar.
**Tokens:** choices `rounded-tile border-2`, chosen `border-ink bg-table`, unchosen `border-border-subtle hover:border-border-control`. The check circle is `border-border-control`, or ink when chosen. The own-step select and input use `fieldStyles("sm")`. The disclosure is dashed `border-border-control`, then solid ink once open.

| Prop | Type | Notes |
|---|---|---|
| `steps` | `DraftStep[]` | Steps Larry saved, chosen by default |
| `suggestions` | `DraftStep[]` | Fixed fallback ideas |
| `suggestInput` | `SuggestInput` | What Larry may write fresh ideas from |
| `withPerson`, `ownerName` | string | |
| `waiting` | boolean | Larry is still replying |
| `canKeepTalking` | boolean | |
| `intro`, `extra` | | |
| `onCancel`, `onSave`, `onDone` | fn | |

| State | Behaviour |
|---|---|
| Ideas loading | Three still skeleton rows (Skeleton primitive, **new: no pulse loop**) and "Larry is writing a few ideas from your picks…" (status) |
| **Ideas failed (new)** | The fixed ideas show, with "These ideas come from your common ground. Larry can write fresh ones next time." |
| Something chosen | Ink "Save this step" or "Save 2 steps" |
| Nothing chosen | Not ready yet: "No step today" (quiet), then "Pick the easiest one" (or "Write my own step") |
| Waiting | "Waiting for Larry…", spinner, `aria-disabled`, wait cursor |
| Saved with a person | `ShareStep` |

**Edge cases:** the lowest-pressure idea starts chosen. One AI call per distinct session state (cached). Own steps are capped at 140 letters.
**Accessibility:** choices are `aria-pressed` buttons. "Larry saved this" is said for Larry's steps. Focus moves to the heading.

---

## 6. Chrome, mascot and motion

### 6.1 SiteHeader, `ROOM_HREF`, `SOLO_LABEL`
`site-header.tsx`. **Status: Ready.**

**Overview:** the logo mark and the main navigation. On phones, one Menu button holds everything.
**Layout:** `flex justify-between px-5 py-4` (`px-8` from `sm`). The logo is two stacked mini cards (`rounded-inner`, `bg-cat-film` and `bg-ink`) and "Larry" in Anybody title-sm. Links are 48px pills with an icon and a word. The phone menu is absolute, `w-[min(18rem,100vw-2.5rem)]`, `rounded-panel border-2 border-ink shadow-panel`, with `InstallApp` at its foot.
**Props:** `className`, and `children` (extra items before the links).

| Element | State | Behaviour |
|---|---|---|
| Link | Current page | `aria-current="page"`, paper ground with an ink ring |
| Link | Hover | Paper ground |
| Menu | Open | X icon, `aria-expanded`, panel shown |
| Menu | Escape | Closes and returns focus to the button |
| Menu | Tap outside | Closes |

**Responsive:** under 768px only Menu shows. From `md`: Rooms, Talk taste and First Steps. From `lg`: "Your taste" too.
**Accessibility:** a `header` landmark with `nav` labelled "Main". The logo link is named "Larry home". The menu button has `aria-controls`.

### 6.2 InstallApp
`install-app.tsx`. **Status: Ready.**

**Overview:** "Install app": the browser's own prompt where there is one, Add to Home Screen steps on iPhone, and nothing once installed.
**Layout:** a quiet button with a `Download` icon. On iOS, a numbered list (`rounded-mini bg-paper p-3 ring-2 ring-ink`) toggles under it.

| State | Behaviour |
|---|---|
| Hidden | Installed, standalone, or no way to install: renders nothing |
| Prompt | Tapping opens the browser's install sheet |
| **Asking (new)** | While the sheet is open: spinner, `aria-disabled` and `aria-busy`, taps ignored. If the browser refuses, the button simply goes |
| iOS | Tapping toggles two steps (`aria-expanded`, `aria-controls`) |

**Accessibility:** its name is the visible text. The steps are an `ol`.

### 6.3 LarryAvatar, `LARRY_ALT`
`larry-avatar.tsx`. **Status: Ready.**

**Overview:** Larry's mascot. The face crop is for chat sizes, the full mascot for big spots.
**Layout:** a square `next/image` with `rounded-tile bg-table ring-2`.
**Props:** `size` (`"xs"` 24px in composer chips, `"sm"` 28px in inline notes and headers, `"md"` 36px in chat, the default, `"lg"` 48px on the meet screen and the landing), `variant` (`"face"` or `"full"`), `quiet` (line ring) and `decorative` (empty alt, hidden).
**States:** default (ink ring), quiet (line ring, never a fade).
**Accessibility:** alt "Larry, an AI pal" unless decorative (next to words that already say who it is).

### 6.4 DealIn
`deal-in.tsx`. **Status: Ready.**

**Overview:** the deal: a card slides in from its side and settles, once.
**Props:** `from` (`"left" | "right" | "below"`), `delay` (seconds), `className` and `children`.
**Motion:** from x ±48px with a ±10deg turn (or y 56px, -4deg and scale 0.9) to rest, over `DURATION.deal` with `EASE_DEAL` **(now read from the tokens; it was 0.7s with a copied curve)**. Transform only, so the card is visible before hydration. Under reduced motion it snaps.
**States:** dealing, rested.

### 6.5 HelpDialog
`pair/help-dialog.tsx`. **Status: Ready.** Built on the `Dialog` primitive (md).

**Overview:** "Need help now?", always one tap away in sessions. Larry is not a crisis service.
**Layout:** a `Dialog` (`size="md"`): a `LifeBuoy` title, a calm line, three table-ground tiles (emergency number, someone you trust, helplines: India Tele-MANAS 14416, UK and Ireland Samaritans 116 123, USA 988) and a full-width primary link to findahelpline.com.
**API:** a `ref` with `open()`.
**States:** closed, open. Scrim tap and Close close it.
**Accessibility:** labelled by its title. The external link says "(opens in a new tab)". Crisis copy changes need 3G's sign-off.

### 6.6 SkipLink
`skip-link.tsx` (added during the final build). **Status: Ready.** Mounted once in `app/layout.tsx`, before everything else.

**Overview:** the keyboard's first stop. It jumps past the header to the page's `<main>` (WCAG 2.4.1).
**Layout:** `sr-only` until focused. On focus it is a fixed ink pill in the top-left corner (`left-3 top-3`, `min-h-12`, `px-5`, `rounded-full`, `bg-ink text-paper`, `shadow-button`, `z-[100]`).
**Props:** none.
**States:** hidden (not focused), shown (focused; the inverse focus ring applies on ink), used (focus moves to `<main>`, which gets `tabindex="-1"` if it has none).
**Edge cases:** every page must have exactly one `<main>`. Without one, the link falls back to its `#main` anchor.
**Accessibility:** a real link, named "Skip to main content".

### 6.7 MotionProvider
`motion-provider.tsx` (added during the final build). **Status: Ready.** Wraps the app in `app/layout.tsx`.

**Overview:** framer-motion's `MotionConfig reducedMotion="user"`. Under the phone's reduce-motion setting, motion components drop movement (deals, slides, flips) and keep only fades. The CSS clamp in `globals.css` cannot reach animation driven from JS, so this covers components that do not check `useReducedMotion()` themselves.
**Props:** `children`. **States:** n/a (no UI).

---

## 7. Safety

### 7.1 BlockReport
`safety/block-report.tsx`. **Status: Ready, with debt** (reason choices are hand-drawn tiles, section 9).

**Overview:** block or report, one tap away. Block is permanent and both ways, and the person is not told. Report keeps the last messages for review and blocks too.
**Layout:** the trigger is a 48px round shield button (`variant="icon"`) or a secondary pill. The sheet is a `Dialog` (`size="md"`) with steps: choose, then block or report, then done.
**Tokens:** reason choices `rounded-tile border-2`, `border-border-subtle bg-table`, chosen ink.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `target` | `SafetyTarget` | required | A room member or a meet group |
| `who` | string | `"this person"` | |
| `variant` | `"icon" \| "pill"` | `"icon"` | |
| `plural` | boolean | false | "are blocked" |
| `onDone` | `(kind) => void` | — | Runs when the sheet closes after success |

| State | Behaviour |
|---|---|
| Choose | Two secondary buttons: Block, Report |
| Block | Says what happens. Primary "Block Sam" |
| Report | Reason choices (`aria-pressed`). "Report and block" is in the not-ready style (`aria-disabled`) until a reason is picked, but still answers a tap |
| Report without a reason | "Pick what happened first." (alert) |
| Busy | `<Button loading>`: spinner, `aria-disabled`, `aria-busy` |
| Error | The server message, `role="alert"` |
| Done | "Sam is blocked. You won't see each other again." plus a calm safety line and OK |

**Accessibility:** the icon trigger is named "Block or report Sam". The sheet is labelled by its title, which changes per step.

---

## 8. Rooms (`components/room/`)

### 8.1 RoomScreen (with Ended and JoinScreen)
`room/room-screen.tsx`. **Status: Ready.**

**Overview:** `/room/[code]`: the live room when this phone is a member, otherwise a preview and one-tap join.

| State | Behaviour |
|---|---|
| Bad code | "This code doesn't look right" plus what a code looks like and "Start or join a room" |
| Gone (404) | "We couldn't find this room" plus why, and the room leaves "Your rooms" |
| Reading storage | An empty box (one frame) |
| Preview | "Join Sam and Priya" plus a line, then your card and "Join with my card", or `QuickCard` |
| Joining | Spinner, "Joining…", `aria-disabled` |
| Full | "This room is full. A room has up to 5 people." (alert) and "Start a new room" |
| Error | Danger line (alert) |

### 8.2 LiveRoom
`room/live-room.tsx` (a screen, 1,050 lines). **Status: Ready.** Messages render `ChatBubble`; Invite, Finish and Leave are one `dialog` state ("invite" | "finish" | "leave" | null).

**Overview:** the room: who is here, how to get in, the group's common ground, the chat, the composer, Finish and Leave.
**Layout:** one column on phones. From `lg`, two columns: the table on the left (sticky, scrolls on its own) and the chat on the right (28rem) with the composer fixed to the bottom.

| State | Behaviour |
|---|---|
| Opening | "Opening room LARRY-…" with a spinner (status) |
| Waiting for others | "You're the first one here. Invite 1 to 4 people." plus `InvitePanel` (row) |
| Common ground loading | "Asking Qloo what your cards share…" (status) plus two `BridgeCardSkeleton`s **(new: shared skeleton, no pulse)** |
| Common ground slow (20s) | "Qloo is busy right now, so this is taking longer…" with a clock icon |
| Ready | Bridges and shared picks. 4 shown on wide screens, 2 on phones, then "Show more" |
| Offline (3 failed polls) | "Reconnecting… New messages will show when you are back online." |
| Send error | Danger line (alert) |
| Larry thinking | `TypingRow` plus "Larry is thinking" in the status |
| Larry stepped back | `FadeChip` with "Need Larry?" |
| Excused | The composer banner, room-wide |
| Open to meet | "You both waved", the venue, what you share, and Block or report always shown |

**Accessibility:** h1 "3 of you in the room". A polite announcer covers joins, moves and Larry. Safety controls are in a list labelled "Block or report".

### 8.3 room-chat: MoveTag, RoomEvent, TypingRow, FadeChip, GroupStepCard
`room/room-chat.tsx`. **Status: Ready.** (Room messages use `ChatBubble`; `RoomBubble` was removed.)

| Component | Overview and layout | Props | States |
|---|---|---|---|
| `MoveTag` | In a Larry `ChatBubble`'s `footer`: "Larry is inviting Priya in" or "Larry asked you", with a seat dot and icon | `move` | invite, ask |
| `RoomEvent` | A centred pill between messages: "Priya joined." | `text`, `color` | static |
| `TypingRow` | Three dots plus words ("Checking Qloo for games…") | `text` | animated dots (motion-safe), still under reduced motion |
| `FadeChip` | "You all seem fine without me…" plus "Need Larry?" | `onWake` | static |
| `GroupStepCard` | Larry's group First Step: kind pill, text, "With Sam and Priya", Save | `kind`, `text`, `forNames`, `saved`, `onSave` | unsaved, saved (coral ring, "Saved on this phone", See my First Steps) |

### 8.4 LearnedNote, `usePersonaLearning`
`room/larry-learned.tsx`. **Status: Ready.**

**Overview:** "Larry learned: You like Stardew Valley." A paper note with Undo, so nothing is learned behind the person's back.
**Layout:** `rounded-bubble bg-paper px-3 py-2 ring-2 ring-line`: icon, text (up to 3 lines plus "Saved to your taste on this phone."), Undo (48px) and Close (48px).
**States:** shown, undone (removed), dismissed. The hook ignores empty updates.
**Accessibility:** `role="status"`. Close is labelled "Close note".

### 8.5 InvitePanel, InviteDialog
`room/invite-panel.tsx`. **Status: Ready.** `InviteDialog` is the `Dialog` primitive (md, controlled: `open`, `onOpenChange`).

**Overview:** how others get in: a QR code, the code large enough to read across a table, Copy link and Share.
**Layout:** `layout="stack"` (QR centred above, up to 14rem) or `layout="row"` (a 11rem QR beside the code from `sm`). The code is Anybody 900 at `text-code`, with the "LARRY-" prefix small above the spaced code.

| Element | State | Behaviour |
|---|---|---|
| QR | **Loading (new)** | Block skeleton, status "Making the QR code." |
| QR | Ready | Alt "QR code. It opens room LARRY-7KQ2MX." |
| QR | **Failed (new)** | "The QR code didn't load. Share the code instead." in the square |
| Copy | Copied | Check icon, "Copied", and "Room link copied." for 4s |
| Copy | Failed | "Couldn't copy. Here is the link:" plus the link, selectable |
| Share | Phone has no share sheet | Button hidden |

**Accessibility:** the code is read letter by letter (`sr-only`). The status region is polite.

### 8.6 FinishDialog, LeaveDialog
`room/room-finish.tsx`. **Status: Ready.** Both are the `Dialog` primitive, controlled (`open`, `onOpenChange`): Finish md, Leave sm with Stay as `initialFocus`.

**Overview:** Finish is the room's way out to the real world: Larry's Plan Ticket or group steps first, each with its own Save. Leave confirms leaving.

| State | Behaviour |
|---|---|
| With a ticket | `PlanTicketView variant="dialog" afterSave="close"`, then "Or a smaller step" |
| No Larry steps | "Ask Larry for a group plan" (`<Button loading disabled>`: busy shows a spinner with `aria-busy`; excused or unavailable is the not-ready style with a reason line) |
| Ideas loading | Status line plus three still skeleton rows **(new: Skeleton primitive)** |
| Step saved | Coral edge, "Saved" text replaces the button |
| Leave | "Leave this room?" with the unsaved count. Stay (primary), Leave (quiet; leaving shows a spinner with `aria-busy` and ignores taps **(new)**) |

### 8.7 Helpers (not visual)
`room/room-api.ts` (codes, credentials, fetch wrappers, `RoomError` with warm messages), `room/room-utils.ts` (`seatColor`, `joinNames`, `groupBridgeLines`, `bridgeMemberIds`) and `room/addressed.ts` (`addressedMember`: who Larry just asked). These are covered by unit tests. `seatColor` reads a member's stored colour through `normalizeSeatColor` and falls back to `seatColorAt(i)`, so every room path uses the one `SEAT_COLORS` list.

---

## 8b. Groups and Larry's next move (Stage 2, current)
Section 8 above describes the retired rooms; the screens below replace them.

### 8b.1 GroupQrPanel (`group/group-qr.tsx`)
**Status: Ready.** The live group QR on the foil-edged ink card, the countdown line and "Close joining". Props: `group`, `join`, `onClose`, `closing`, and optional `onApplied(state)`, which hands a server answer (a demo friend joined) back to the chat so it updates without waiting for the poll.
**Demo-only section:** "Let a demo friend scan it" renders only when `GET /api/groups/<id>/demo-friends` returns friends, which happens only for the one demo account (the server checks it; everyone else gets a plain 404 and the section never renders). One 48px button per demo friend, the name in the label. Helpers in `group/group-api.ts`: `demoFriendOptions`, `demoFriendScan`.

### 8b.2 Member names (`memberLabel`, `DEMO_FRIEND_LABEL`)
`GroupMemberView` and the friends list's `FriendView` carry `isDemoFriend`. Every place a member's name is shown goes through `memberLabel(m)` ("Mira (Demo friend)"): chat bubbles, the chat header ("with a demo friend"), Members, the Unfriend/Block/Report picker, the group list and the friends list. Demo friends never get a profile link, and `/profile/<their name>` answers not found.

### 8b.3 NextMovePopup, NextMoveView `sheet`, HomeTop (`next-move/`)
**Status: Ready.** Larry's next move as a `Dialog` (bottom sheet on phones, centred card on desktop) for a signed-in person with a card. `popup-rules.ts` holds the pure rules: opens by itself at most once a day (`larry.nextmove.shownOn`, a date only) and only for a real move (not make-card). The pill (`data-testid="next-move-pill"`, 48px, avatar + "Larry's next move", `press-hard`) reopens it. Buttons: "Not now" (closes, announces "Okay. Larry will suggest something else next time.", remembered per skippable move type; two skips lead to a smaller step) and "Something smaller" (swaps in the smaller step from `nextMove()`, focus to its heading). "Need help now?" inside opens `HelpDialog` beside the popup. `HomeTop` shows the original hero to visitors and device-only people, an empty placeholder while sign-in is checked, and for signed-in people "Hi, {name}.", the pill and Start a group / Your groups / Talk taste / Pick a pal, plus "Scan a group QR".
**Motion:** the sheet slides in with `motion-safe:` classes (`--dur-base`, `ease-deal`); still under reduced motion.

---

## 9. Known debt and who fixes it
These are not missing states. They are older patterns that still work but drift from the system. Owners follow the plan's stage ownership (`research/final-build-plan.md`).

| Debt | Where | Fix | Owner |
|---|---|---|---|
| Report reasons are hand-drawn option tiles | `BlockReport` reason buttons (`rounded-tile border-2`, pressed ink) | A `Segmented layout="wrap"` or a shared option-tile primitive | Stage 3 |
| Duplicate opener text | `PlanTicketView` prints the opener, and `ShowThis` keeps the same text in its closed dialog, so `getByText(opener)` finds two matches | Scope tests to the visible opener, or render dialog content only while open | Owner of the `ShowThis` change |
| Private milestones still use the v1 words | `lib/checkins.ts` (First visit, Regular, Local at 1, 3 and 8 visits) | Rookie to Legend from `lib/titles.ts` (Check-in v2) | 1B |
| One 1px edge left | `app/page.tsx` play mat inner frame (`border border-border-subtle-inverse`) | Fine as decoration on the mat; make it `border-2` if the mat is redrawn | Stage 3 |

Fixed in the Stage 0 design pass (30 Oct), no longer debt: every modal is `Dialog` (8 call sites, widths `--dialog-sm`/`--dialog-md`, heights `--dialog-max-h`); one `ChatBubble` (pair, Talk taste and rooms); one `BridgeCard` with `people: Seat[]`; `VenueCard` deleted; "Best fit" and the milestone pill are `Badge`; chips use `chipStyles()`; not-ready buttons use the base `aria-disabled` style instead of switching to secondary (create, join, room, me, quick card, meet); seats come from `SEAT_COLORS` / `seatColorAt` on every path (rooms, pair, demo); alpha edges (`paper/15…30`, `ring-danger/30`) are gone; `--border-frame` everywhere a 3px frame or ring is drawn; `ring-1` is gone; one `--text-code` token for codes; durations read `--dur-*` / `DURATION`; Anybody is 900 everywhere; `LarryAvatar size`, `StepKindPill variant` and `PlanTicketView variant/afterSave` replace pixels and booleans.

---

## 10. States added in this pass
Each was missing from the audit or from the documented states, and is now built:

| Component | State added |
|---|---|
| `Switch` | `busy` and `disabled` (`aria-disabled`, `aria-busy`, tone change, taps ignored) |
| `Segmented` | `error` (danger line, `aria-invalid`, `aria-describedby`) and `disabled` (choice kept visible, arrows still move focus) |
| `Field` / `SelectField` | Disabled and read-only styles (tone change, never a fade) |
| `Stamp` | `fresh`: dealt in once with the deal tokens (transform only) |
| `Poster`, `PlaceCard`, `Thumb` | Image failed to load: falls back to the card back, dashed frame or icon |
| `BridgeCard` | Loading: `BridgeCardSkeleton`, now used by `LiveRoom` |
| `ShareStep`, `InvitePanel` | QR loading (status plus skeleton) and QR failed (words in the square) |
| `PlanTicketView` | Save failed (warm alert, retry) and no daytime time (no invented times) |
| `PicturePicker` | Search error with a working "Try again" |
| `EndPanel` | Larry's ideas failed (a quiet line), and still skeletons instead of a pulse loop |
| `FinishDialog`, `LeaveDialog`, `QuickCard`, `BlockReport` | `aria-busy` on busy buttons, and Leave ignores taps while leaving |
| `AccessCodeForm` | Shared busy style (was a one-off override), a 3:1 field edge and a danger edge on error |
| `InstallApp` | Asking: busy while the browser's install sheet is open |
| `DealIn`, `SiteHeader` | Motion and radius read from tokens |

Tests: `src/components/ui/states.test.tsx` covers the new primitive states (10 tests).
