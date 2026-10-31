---
name: Larry
description: Talk to someone, not something. Your taste is a trading card; common ground is dealt between two cards.
colors:
  table: "#f4f1ff"
  ink: "#14121f"
  ink-soft: "#4a4560"
  paper-soft: "#c9c5da"
  ink-hover: "#2a2640"
  line: "#ddd6f3"
  paper: "#ffffff"
  mat: "#221d36"
  ink-500: "#7d7896"
  focus-ring: "#5a3fd6"
  scrim: "rgb(20 18 31 / 0.6)"
  danger: "#b42318"
  cat-film: "#ff5a5f"
  cat-tv: "#ffd23f"
  cat-music: "#2ec4b6"
  cat-games: "#7b61ff"
  cat-games-ink: "#5a3fd6"
  cat-games-tint: "#9d8bff"
  cat-books: "#ff9f1c"
  cat-sports: "#26a69a"
  cat-players: "#4aa3ff"
  cat-podcasts: "#e879f9"
  cat-brands: "#b8aa9a"
  cat-travel: "#9cc7e8"
  cat-people: "#ff8fb8"
  heat-1: "#ece8fb"
  heat-3: "#8f88ab"
typography:
  display:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "clamp(1.75rem, 9.6cqi, 5.25rem)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  title-page:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "clamp(2rem, 6vw, 3.25rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title-session:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "clamp(1.6rem, 5vw, 2.1rem)"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  step:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "3rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title-lg:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title-md:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "2rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "Anybody, Atkinson Hyperlegible, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  intro:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.6
  lead:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.4
  caption:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 700
    lineHeight: 1.35
rounded:
  inner: "0.35rem"
  tile: "0.6rem"
  badge: "0.85rem"
  mini: "1.1rem"
  bubble: "1.25rem"
  card: "1.4rem"
  panel: "1.75rem"
  pill: "9999px"
spacing:
  gap: "0.5rem"
  stack: "0.75rem"
  section: "1.5rem"
  page-x: "1.25rem"
  measure: "52ch"
  dialog-sm: "28rem"
  dialog-md: "34rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "3.5rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "3.5rem"
  button-compact:
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "3rem"
  button-busy:
    backgroundColor: "{colors.table}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    height: "3.5rem"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mini}"
    padding: "0 1rem"
    height: "3.5rem"
  chip-choice:
    backgroundColor: "{colors.table}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "3rem"
  chip-choice-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  switch-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "3rem"
  switch-off:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "3rem"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "{spacing.dialog-md}"
  badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 0.75rem"
  title-badge-stage:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.badge}"
    size: "3rem"
  title-badge-podium:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.badge}"
    size: "3rem"
  taste-card:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.card}"
  bridge-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.mini}"
    padding: "0.625rem"
  composer:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "0.5rem"
  bubble-larry:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.bubble}"
    padding: "0.625rem 1rem"
  bubble-person:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
    padding: "0.625rem 1rem"
---

# Design System: Larry

## Overview

**Creative North Star: "The Card Table"**

Your taste is a trading card. Scanning someone's card is a trade, and common ground is dealt between the two cards onto a lilac-white table. Every surface in Larry sits somewhere on that table. The taste card is an ink card face with poster windows. Bridges are smaller paper cards dealt between two players. The landing hero is a dark play mat with marked slots. A saved First Step goes home as a card back with a QR code. A title is a small card you earned at a real place. The world refuses the default chatbot shell (white bubbles and one blue accent) and the cream-serif wellness look.

The audience includes people with social anxiety, speech difficulties or Down syndrome, so the card world carries hard constraints. Type is large and legible, and targets are big enough to tap with a shaky hand. Colour is never the only carrier of meaning. The trading-card metaphor stops at what is earned outside: Glory, titles, stages and counts exist only for verified real-world things (**The Earned Outside Rule**, below), never rarity, loot or a currency.

**Key Characteristics:**
- Ink card faces with thick frames in a category colour, and real Qloo poster art in the windows.
- A heavy, slightly expanded display face for names and headings only; a low-vision reading face for everything else.
- One orchestrated motion, the deal, then everything rests.
- Every action has a tap-only path, with targets of 48px or more and at least 8px between them.
- Three token layers: primitives (hex values), semantic roles (surface, text, border, focus, seat, motion), and a few component sizes. Components read the semantic layer.

The words Larry uses for titles, stages, moods and signals, with their icons and who may see them, live in `docs/glossary.md`. Use those words exactly.

## Colors

The table is cool lilac-white, the cards are near-black ink, and eleven saturated frame colours encode which category each item belongs to.

### Primary
- **Card Ink** (ink, #14121f): card faces, primary buttons, Larry's chat bubbles, all body text. On the table it gives 17:1.
- **Ink Hover** (ink-hover, #2a2640): the hover state of ink buttons, one step lighter.

### Secondary: category frames
Eleven categories, one frame colour each, in the `--cat-*` namespace: Film coral (`--cat-film`), TV yellow (`--cat-tv`), Music teal (`--cat-music`), Games violet (`--cat-games`), Books orange (`--cat-books`), Sports blue-green (`--cat-sports`), Players blue (`--cat-players`), Podcasts orchid (`--cat-podcasts`), Brands warm grey (`--cat-brands`, formerly `--brand`, renamed so nobody mistakes it for "the brand colour"), Travel sky blue (`--cat-travel`) and People pink (`--cat-people`). The old un-prefixed names (`--film`, `--brand` and so on) stay as aliases for one release; new code uses `--cat-*`.

Each frames posters, category icon discs and bridge cards of its kind. Ink text on each, as used by poster fallbacks:

| Category | Ink on it | Note |
|---|---|---|
| Film | 6.06:1 | |
| TV | 12.8:1 | The frame almost disappears on paper (1.44:1); the label and icon carry it |
| Music | 8.5:1 | |
| Games | 4.40:1 | Fails small ink text, so titles sit on `--cat-games-tint` (6.7:1) instead |
| Books | 9.0:1 | |
| Sports | 7.3:1 | |
| Players | 7.0:1 | |
| Podcasts | 7.5:1 | |
| Brands | 7.9:1 | |
| Travel | 9.4:1 | |
| People | 8.7:1 | |

- **Text-safe violet** (`--cat-games-ink`, #5a3fd6): violet text and stamps. Games violet itself fails small-text contrast (3.8:1 on the table).
- **Violet tint** (`--cat-games-tint`, #9d8bff): the poster fallback behind ink titles in the Games category. Only Games needs `-ink` and `-tint` variants today; a new category adds them only if it ever needs text or a fallback behind ink.

### Neutral
- **Table** (table): the page ground everywhere, and the browser theme colour.
- **Paper** (paper): bridge cards, composer, panels, inputs, user bubbles.
- **Ink Soft** (ink-soft): secondary text, 8:1 on the table.
- **Paper Soft** (paper-soft): secondary text on ink and on the play mat (11:1 on ink, 9.6:1 on the mat). Never paper at reduced opacity.
- **Line** (line): hairlines, skeleton bars, dashed empty states.
- **Play Mat** (mat): only under the landing hero's cards, one step lighter than a card face so the ink cards still separate from it.
- **Control border** (`--ink-500`, #7d7896, read through `--border-control`): the edge of every text field and select. 4.20:1 on paper and 3.78:1 on the table, so it passes WCAG 1.4.11 (3:1).
- **Focus** (focus-ring, #5a3fd6): the focus outline, 6:1 on the table and 6.7:1 on paper. It is its own role, so a focused Games bridge no longer shows violet on violet. On ink and the mat, where it is too dark, `--focus-ring-inverse` (games tint, 6.7:1 and 5.8:1) takes over.
- **Danger** (danger, #b42318): error text, 5.91:1 on the table (AA). Error copy is still warm: the colour marks it, the words never alarm.

### Semantic roles (components read these, not the primitives)
| Role | Tokens | Maps to |
|---|---|---|
| Surfaces | `--surface-page`, `--surface-raised`, `--surface-inverse`, `--surface-mat` | table, paper, ink, mat |
| Text | `--text-primary`, `--text-secondary`, `--text-on-inverse`, `--text-on-inverse-secondary`, `--text-danger` | ink, ink-soft, paper, paper-soft, danger |
| Borders | `--border-subtle`, `--border-subtle-inverse`, `--border-control`, `--border-strong` | ink at 15%, decoration only (chips are known by their words); the same on ink and the mat (paper at 20%); field and select edges and the hover edge of subtle chips (`--ink-500`, ≥3:1); ink |
| Scrim | `--scrim` | ink at 60%, behind every dialog |
| Focus | `--focus-ring`, `--focus-ring-inverse`, `--focus-width`, `--focus-offset` | #5a3fd6 on light grounds; games tint (#9d8bff) on ink and the mat; 3px wide at a 3px offset |
| Seats | `--seat-1` … `--seat-5` | film, music, players, books, tv, in that order (players, not games: ink initials on games violet are only 4.4:1). One list in TS too: `SEAT_COLORS` and `seatColorAt(i)` in `src/lib/tokens.ts`, used by web rooms (`lib/rooms/service.ts`, `room-utils.ts`) and the pair session and demo (`PAIR_SEATS` in `lib/demo.ts` is its first two). Rooms saved before the tokens are mapped by `normalizeSeatColor` |
| Heat | `--heat-1` … `--heat-5` | #ece8fb, paper-soft, #8f88ab, ink-soft, ink: one lilac-to-ink ramp for "Where your people are" |

Exact values live in `src/app/globals.css`. Colours needed in TS (theme colour, QR, seats) come from `src/lib/tokens.ts`, never a new hex in a component.

### Named Rules
**The Category Rule: category = colour + icon, always.** Eleven hues cannot stay apart for everyone. Sports (blue-green), brands (warm grey) and travel (sky blue) were moved so the worst pairs no longer merge under colour-blind simulation (film/sports, music/brands and brands/people were near-identical; travel looked like books), but some pairs stay close (books and people under tritanopia). So every category mark shows its frame colour **and** its own Lucide icon or label, and no two categories share an icon (a unit test in `src/lib/domain-style.test.ts` checks this). Never show a category by colour alone.

**The Seat Rule.** Seats borrow category colours, so a seat colour can match a bridge's frame. A seat therefore always has a second cue: the person's name or initial beside the dot, or a fixed position (seat a on the right). Seat order is one list, `--seat-1…5`.

**The Frame Rule.** Category colours are frames, discs and markers, never text on paper. Coral and teal text fail contrast, so a seat colour appears beside a name, never as the name.

**The Neutral Marks Rule.** Titles, stages, Glory, moods, signals (Match Day, Rising, Hidden Gems, Taste Twin), step kinds and vibe chips are neutral: ink, paper, table and line. The eleven hues are used up by categories, and a yellow "Final Boss" would read as TV. No gold, silver or bronze anywhere.

**The No Opacity Text Rule.** Quiet or disabled states never fade text. Larry's quiet mode switches to a paper bubble with ink-soft text, and a full picker fades only the poster.

## Typography

**Display Font:** Anybody (variable, set at 112% width), with Atkinson Hyperlegible as fallback.
**Body Font:** Atkinson Hyperlegible (400 and 700), designed for low-vision readers.

**Character:** a heavy, wide card-title voice next to a calm, very open reading face. The contrast is the trading card itself: a loud name and a plain rules box.

### Hierarchy
- **Display** (`--text-display`, 900, clamp(1.75rem, 9.6cqi, 5.25rem), line-height 0.95): the landing headline only. It scales with its container, not the viewport.
- **Page title** (`--text-title-page`, 900, clamp(2rem, 6vw, 3.25rem)): page headings such as "Your common ground" and "Make your taste card". One size for every page h1.
- **Session title** (`--text-title-session`, 900, clamp(1.6rem, 5vw, 2.1rem)): headings inside the pair session, rooms and the end panel.
- **Step** (900, 3rem): the landing's "Tap. Swap. Go." words, in category colours on ink.
- **Title lg / md / sm** (2.25rem / 2rem / 1.45rem): error-page headings / lg card names / panel headings, md card names, title-card words and the logo.
- **Intro** (1.25rem) and **Lead** (1.15rem): intro paragraphs on the landing page and on app pages.
- **Body** (1.0625rem, line-height 1.55): reading text, chat bubbles, buttons and inputs. Reading text sits inside `--measure` (52ch), the one reading width.
- **Label** (700, 0.95rem): chips, quick replies, compact buttons, sender names, reason lines, badge words.
- **Caption** (700, 0.85rem): poster fallback titles, match pills, signal badges, rank numerals, small meta. Never smaller: nothing in the app sets text under 0.85rem.

Anybody is always 900 (`font-black`), at every size: there is no 800 or 850. Labels and captions are sentence case, never uppercase or letter-spaced. The one exception is the stamped "Done" mark, which imitates a rubber stamp.

### Named Rules
**The Display Is For Names Rule.** Anybody sets names, headings, title words and numerals only. Sentences are always Atkinson Hyperlegible.

**The Easy-Read Rule.** No "·", "×", "&" or arrows as joiners in copy. Write full short sentences: "Sam likes Minecraft. Priya likes Spirited Away." Counts are words: "Final Boss at 2 places", not "Final Boss ×2".

**The Plain Line Rule.** Every witty Larry line has a plain line beside it ("Someone here likes Spirited Away too."), in body text under the witty one. The "Plain words" setting hides the witty line and keeps the plain one.

## Layout

Content sits in one column on phones (max about 48rem) with 1–1.25rem side padding. The pair session is the exception on wide screens. At 1024px and up it becomes two columns: the common ground (sticky, scrolls on its own) on the left, and the chat with its composer pinned to the bottom on the right. On phones the composer is fixed full-width. Its height and the sticky header's height are measured into `--composer-h` and `--header-h`, which drive `scroll-padding` so focused content is never hidden. Below 500px of viewport height both become static, so zoom and soft keyboards still leave room to read; on phones and tablets the composer already becomes static below 640px. When Larry's opening arrives on a phone, the page scrolls only as far as needed for the opening to end just above the composer.

Rhythm: gap-2 (0.5rem) between related controls, 0.75rem stacks, 1.5rem between sections, and larger breaks (3–4rem) only on the landing page. Reading text is capped at `--measure` (52ch). Dialogs are `--dialog-sm` (28rem: confirmations) or `--dialog-md` (34rem: forms and help), always `min(width, 100% - 2rem)`, and scroll inside `--dialog-max-h` (85dvh). Panels in the composer slot scroll inside `--panel-max-h` (70dvh; the share sheet `--share-max-h`, 80dvh). A room or access code is `--text-code`. Nothing scrolls sideways.

## Elevation & Depth

Depth is cards lying on a table: soft shadows tinted with ink, cast downward, larger for bigger cards. Nothing floats above the table without a reason. Dialogs sit on `--scrim` (ink at 60%), the one backdrop.

### Shadow Vocabulary
- **button**: primary ink buttons on floating bars (the session bar's Finish). Primary buttons lying on the page carry none; the ink fill already lifts them.
- **panel**: the composer, the end panel and dialogs.
- **mini**: dealt bridge cards and title cards.
- **deal**: the hero bridge card on the play mat.
- **card**: taste cards and the play mat.

(Exact values live in `globals.css` and the sidecar.)

### Motion
One easing and three durations, as tokens: `--ease-deal` (cubic-bezier(0.16, 1, 0.3, 1), exponential ease-out), `--dur-quick` (180ms: morphs, colour and press feedback), `--dur-base` (250ms: notes and banners in and out) and `--dur-deal` (600ms: the deal, for bridges, a new title card, a Glory gain and the Guess vs Reality reveal). TS motion code reads the same values from `src/lib/tokens.ts`. Under `prefers-reduced-motion: reduce` every move is off, and nothing that carries meaning (focus, state) depends on motion.

**Press (tactile, user decision 31 Oct).** Every button, link button, chip, segmented option, switch and hand-rolled pill carries `press` (globals.css): at rest it sits on a thin hard edge, its thickness on the table; hover lifts it 1px; pressed, it sinks by that edge and springs back over `--dur-quick` with `--ease-deal`. Modifiers: `press-hard` (paper pill with an ink border, ink edge), `press-soft` (chips and option tiles, subtle edge) and `press-flat` (text buttons and round icon buttons: no edge, a 1px sink). There is no scale on press any more. Busy and disabled never press. Under reduced motion nothing moves, but the edge still collapses.

**Page deal.** `app/template.tsx` (and `app/group/template.tsx` inside the groups section) wraps pages in React's `<ViewTransition>`: the old page fades out fast, the new one slides up 12px over `--dur-base`. Off under reduced motion; browsers without the API swap instantly.

**Haptics** (`lib/haptics.ts`, phones that support it, silent under reduced motion): `tick()` on a primary Button press (`haptic={false}` opts out), `success()` once for a counted check-in (it covers the Glory moment, so never twice) and once when a group forms. Never on every tap.

### Named Rules
**The Foil Edge Rule.** Holo foil appears only on a card's frame edge: a 3px conic band in the category colours that follows the pointer. It goes on taste cards and card backs (the QR on /card and the First Step share card), never on buttons, panels, text or title badges (foil on a title would read as rarity).

## Shapes

A radius scale tied to object size: inner poster frames and the logo mark (`--radius-inner`, 0.35rem), poster tiles (tile, 0.6rem), title badge tiles (`--radius-badge`, 0.85rem), dealt bridge cards and fields (mini, 1.1rem), chat bubbles and the mat's inner frame (bubble, 1.25rem), taste cards and title cards (card, 1.4rem), panels, dialogs and the composer (panel, 1.75rem), and pills for every button and chip. Taste cards and title cards are always 5:7. Empty card slots are dashed outlines, never filled grey.

Border weights have roles: 2px for controls, rings and panels; `--border-frame` (3px) for category frames on posters and bridge cards. There is no third weight.

## Components

Components live in `src/components/`. Shared primitives live in `src/components/ui/` and are imported from `@/components/ui`. Primitives take a common prop shape: `size` ("sm" | "md" | "lg", plus "xs" on taste cards) for scale, `variant` for visual style, and `layout` only for arrangement. Boolean style flags are not added; they become `variant` values.

### Buttons (`ui/button.tsx`, `buttonStyles`)
- **Primary:** ink pill, `--button-h` (56px) tall, paper text 1.05rem bold, ink-hover on hover, the `press` sink (see Motion) and a light haptic tick. One per view where possible.
- **Secondary:** paper pill with a 2px ink border.
- **Quiet:** text only, 48px, paper on hover.
- **Sizes:** `size="md"` is the 56px default (`--button-h`); `size="sm"` is the 48px compact row size (`--button-h-compact`, label text).
- **Busy:** `loading` swaps the icon for a spinner and sets `aria-busy`; the label stays, so the text never fades. `loading` and `disabled` both set `aria-disabled="true"` and keep the button focusable, and the shared base styles that once for every button: table or paper ground, a line border, ink-soft text, no shadow. Never the `disabled` attribute mid-conversation, never opacity.
- **Not ready yet** (Save my card, Find our common ground): the secondary style, with the missing step written as ink text beside it.
- **Focus:** the global `--focus-ring` outline (`--focus-width` 3px at `--focus-offset` 3px); `--focus-ring-inverse` on ink and the mat.
- **Accessibility:** a real `<button>` (or a link for navigation), name from its visible text; icon-only buttons carry an `aria-label` and a tooltip.

### Chips (`ui/chip.tsx`)
Choice chips (speaker toggle, quick replies, category filter, step choices, moods, the Plan Ticket's "When") are `--chip-h` (48px) pills with `aria-pressed`. Pressed chips are ink with paper text; unpressed chips rest on paper (`variant="paper"`, on the table) or table (`variant="table"`, inside a paper panel) with a `--border-subtle` edge (chips are identified by their text, so a faint edge is fine). Hover deepens the edge to ink. `busy` sets `aria-disabled`: a line edge and ink-soft text, never a fade. A chip may carry a Lucide icon before its word; never an icon alone.

### Switch (`ui/switch.tsx`)
For on/off settings: Ask Larry or Just us, Hidden gems only, "Show my check-ins to friends", "Just my own progress", Plain words. A 48px pill with a track and knob and the word "On" or "Off" printed, so state is never shown by colour or position alone. On: ink pill, paper text, knob right. Off: paper pill, 2px ink border. `role="switch"` with `aria-checked`; Space and Enter toggle. A change that alters results announces it in a `role="status"` line ("Showing hidden gems only.").

### Segmented control (`ui/segmented.tsx`)
One choice from a short set: age ranges (13–17, 18–24, 25–34, 35–44, 45+) and, in its compact form, mood. `role="radiogroup"` with a visible heading as its label; each option is `role="radio"` with `aria-checked`, at least 48px tall. `size="md"` puts the icon beside the word; `size="lg"` is a tall tile with the icon above the word (the face scale). `layout="wrap"` wraps onto more rows at 320px; `layout="even"` gives every option the same width. Arrow keys move between options. The chosen option is ink with paper text; every option shows a word.

### Inputs / Fields (`ui/field.tsx`)
`--field-h` (56px) fields everywhere (`size="md"`; `size="sm"` is 48px, only inside compact rows): paper ground, mini radius, a 2px `--border-control` edge (≥3:1) that turns full ink on focus, coral caret. The label is always visible above the field; hints and errors are linked with `aria-describedby`, and an error sets `aria-invalid`. Errors are written in danger text and say what to do ("Codes look like LARRY-7KQ2MX. Check the letters with your friend."). A mic button sits beside the field where speech is supported. `SelectField` shares the same box (date of birth uses three selects: day, month in words, year). The one-time code field is `inputmode="numeric"` with `autocomplete="one-time-code"`, and pasting the whole code works.

### Dialog (`ui/dialog.tsx`)
Every modal (Help, Invite, Finish, Leave, Block and Report, access code, Forget steps, the check-in sheet) is one primitive: a native `<dialog>` opened with `showModal()` for the focus trap, on `--scrim`, a paper panel with a 2px ink border, panel radius and the panel shadow, `--dialog-sm` or `--dialog-md` wide, scrolling inside `--dialog-max-h`. It is controlled (`open`, `onOpenChange`) and always prints its title (Anybody, title-sm, with an optional Lucide icon), which names it; an optional `description` of one or two easy-read sentences is linked with `aria-describedby`. The Close button is a 48px target labelled "Close"; `initialFocus` gives first focus to the safe choice instead ("Stay", "Keep them", the code field). Escape, Close and a tap on the scrim all close it and return focus to the trigger; `dismissible={false}` keeps it open for a step that must be answered.

### Skeleton (`ui/skeleton.tsx`)
Loading placeholders in `--line` in the shape of what is coming (`shape`: bar, block, circle or slot, with the card's own radius), so the page doesn't jump when content arrives. No shimmer and no pulse loop. `SkeletonGroup` wraps them in one `role="status"` region that says what is loading once, in words ("Finding your common ground."); the shapes are `aria-hidden`.

### Badge (`ui/badge.tsx`)
A small non-interactive marker: "Best fit", "Made-up pal", and signal badges ("Rising in Mumbai"). Variants: `ink` (paper caption text on ink, for the one strongest marker on a card, such as "Best fit"), `paper` (a 2px ink ring, for neutral signals) and `outline` (a `--border-subtle` ring and ink-soft text, for quiet meta). Sizes: `sm` sits inline in a caption row; `md` is 32px tall on its own line. An optional Lucide icon goes before the word. It is a `span` with its full text; never a target, never colour alone and never icon alone.

### Stamp (`ui/stamp.tsx`)
The earned mark: "Done" on First Steps, and the base of every title badge. Variants: `outline` (paper ground, 2px ink edge, the default), `solid` (ink ground, paper word: the stronger form of the same mark) and `done` (the one uppercase exception, a slightly tilted text-safe violet stamp). Sizes `sm` and `md`, `--radius-badge`. It carries the word, a Lucide icon, an optional `detail` line ("at Café Condi", "2 visits away") and optional pips (`pips` of `pipsMax`, default 5, read as "3 of 5"). Strength shows by pips and by outline versus solid, always next to the word. No metal colours, no foil, no rarity.

### Chat bubble (`ui/chat-bubble.tsx`)
One bubble for the pair session, Talk taste and rooms (no page keeps its own). Props: `sender` ("larry" | "person"), `name`, `initial` (the tile letter when the name line says "You"), `seatColor`, `align`, `quiet`, `excused`, `practice`, `toLarry`, `avatar` and `footer` ("Sending…", what Larry just did).
- **Larry:** ink bubble, Larry's mascot as the avatar (the face crop at chat size, alt "Larry, an AI pal", an ink ring), labelled "Larry (AI pal)" once per run (later ones keep the avatar and a screen-reader name).
- **Quiet Larry:** paper bubble, ink-soft text, a line ring and a line-ring avatar (a tone change, never opacity).
- **Person:** paper bubble with a 2px ring in `seatColor`, an initial tile in the seat colour (the second cue), and the sender's name above; seat a sits on the right.
- **Name line:** adds, in words, "(practice character)", ", to Larry" and ", not seen by Larry" (sent while Larry was excused). `showName={false}` keeps the name for screen readers only, for later messages in a run.
- New messages arrive in a polite live region.

### Face scale (`ui/face-scale.tsx`)
Guess vs Reality and "How did it go?": five face tiles (the Segmented control at `size="lg"`), each a Lucide face with a word under it: Awful, Not great, OK, Good, Great (R8, `FACES`). `FaceMark` shows one face and its word for the reveal cards. A `radiogroup` with a heading; the word is always printed and the scale is never colour-coded. The comparison line reads as one sentence ("You guessed Not great. It was Good."), and is shown only when reality met or beat the guess.

### Cards / Containers
- **Taste card:** ink face, 3×2 poster grid, name in Anybody, a category icon row, foil edge. Sizes: lg 20rem, md 15rem, sm 9.5rem, xs (member rows). Empty slots are dashed; a long name never breaks inside a word.
- **Bridge card:** paper, a `--border-frame` frame in the item's category colour, poster, category label and icon, and one reason line per person with a seat-colour marker and the person's name. It takes a list of seats (2 to 5 people), so pair sessions and rooms share one card. Reasons are never truncated. Cards are sorted by fit and only the first carries a "Best fit" badge; there are no match percentages. "Why this?" opens an easy-read note with no numbers.
- **Place card:** paper row or card (md, lg) with the place photo or a dashed fallback, vibe chips (Calm, Cosy, Lively: neutral, Lucide icon and word), the fit lines, and "Plan this".
- **Plan Ticket:** a paper ticket for one real plan: where, when, the if-then line, the opener as a "show this" card, an optional guess on the face scale, and plan B. Variants: standard and Match Day. States: saved, place closed (offers the next place), shared.
- **Panel:** paper, 2px ink border, panel radius. It scrolls inside 70dvh.
- **End panel:** the lowest-pressure suggestion (or Larry's saved step) starts chosen, so the ink button reads "Save this step". With nothing chosen it follows the Not ready yet pattern: "Finish without a step" is quiet, and "Pick one step to save." sits beside a secondary button.
- **Step kind pill:** paper, 2px ink ring, a Lucide icon and the word (Go, Say, Show). Icon only in narrow phone rows, with the word kept for screen readers.
- **Member card:** a room member's taste card at table size with a seat dot, the seat colour as its ring and the name always printed. Empty seats are dashed.

### Titles, stages and Glory
These follow The Earned Outside Rule and The Neutral Marks Rule. The registry (`src/lib/titles.ts`) holds every word, icon, rank, threshold and meaning; the words are listed in `docs/glossary.md`.
- **Title badge:** an icon tile and the printed word. The family decides the tile, so families differ without colour:
  - Stage (private): paper tile, 2px ink ring, a small `Lock` at the corner, and "Only you can see this" for screen readers.
  - Public podium: ink tile, paper icon, a rank numeral (1, 2, 3) in Anybody on a paper notch.
  - Friends: paper tile, 2px **dashed** ink ring; ranks 1 to 3, Host without a numeral.
  - Sizes: sm (32px tile, inline, not a target), md (48px tile and word, a button when it opens its meaning), lg (a 5:7 title card with the place name under the word, owner and friend views only).
  - States: earned; next (dashed line tile, ink-soft icon, "2 visits away", owner only and only when close); new (dealt in once). A podium place that changes simply isn't there next time: there is never a "you lost" message.
  - Screen reader: "Final Boss, number 1 at Café Condi." The meaning sheet is easy-read: "Final Boss: the most visits here of anyone on Larry."
- **Glory count:** `Sun` icon and "312 Glory" in Anybody numerals. Never animated downward, no decimals. A gain deals in once ("+10 Glory") and is announced politely.
- **Spot and Duo weeks:** words, not streak flames: "3 Saturdays at Café Condi". Paused weeks are not shown as gaps.
- **Venue podium:** the top 3 place aliases at one place, each beside a `MapPin` and "at Café Condi" so an alias is never mistaken for an account username. No link to any profile, no visit numbers, and a re-roll action for your own alias. Below the minimum number of participants it says "Podium opens when more people visit."

### Signals and moods
- **Mood picker:** five choice chips (Chill, Social, Curious, Low energy, Hype), each a Lucide icon and the word, with a meaning line under the group in a `role="status"` region. Variants: full, compact (one chip that opens the full picker) and room (only Larry's blended line, never moods by name). Mood is optional; tapping the chosen mood clears it. Neutral, never a colour per mood.
- **Signal chips:** Match Day (`Goal`), Rising (`TrendingUp`), Hidden gem (`Gem`), Taste Twin (`Blend`). As a badge (caption, 32px), an action chip (48px) or, for Hidden Gems, a switch. Taste Twin is always a full sentence ("Your Minecraft side, in music: beabadoobee."), never an arrow. A signal with no real data behind it is hidden, never faked.
- **Area line ("Where your people are"):** a ranked list of up to 3 areas on the heat ramp, each with its rank and name in words, so colour is never the only carrier. Areas only, never people.

### Navigation
A site header with the logo: Larry's avatar face and the "Larry" wordmark. Wide screens show the places people come back to (Groups, Talk taste, Your taste, First Steps); phones get one Menu button. The menu ends with the app card ("Get the Larry app"), which stands out on ink on purpose.

### Larry's next move (popup)
Not a block on home: a labelled `Dialog` ("Larry's next move", with the avatar) for a signed-in person with a taste card. On phones it is a full-width bottom sheet with a flat bottom; on desktop a centred card. It opens by itself at most once a day and only when there is a real move (`larry.nextmove.shownOn` holds the date). A 48px "Larry's next move" pill with the avatar sits near the top of the signed-in home (`data-testid="next-move-pill"`) and reopens it. Inside: the move (`NextMoveView` in its `sheet` style), "Not now" (remembered per move type; after two skips Larry offers a smaller step) and "Something smaller" (the smaller step from the same `nextMove()` rules, focus moves to its heading; hidden for the Fingerprint, a plan reminder, a check-in or a step that is already the smaller one). "Need help now?" is a button inside the popup and opens the HelpDialog next to it, so the popup never covers help. It slides in only when motion is allowed. Visitors, device-only people and anyone mid-signup never see the popup or the pill; they get the original hero.

### Groups by QR
Start a group (2 to 5 people including you) shows a live group QR on the foil-edged ink card; whoever scans it joins until it is full or 15 minutes pass. The chat header shows who is in; Larry opens with the group's common ground (bridge cards with "Why this?") and then speaks only when tagged through the @Larry button (it pops up the command menu; typing @ or / opens it too). One-tap Members, Leave, Unfriend, Block and Report sit under the header. **Demo friends** (the one demo account only): member names go through `memberLabel()`, so a demo friend always reads "Mira (Demo friend)" in bubbles, the header, Members, the safety picker, the friends list and the group list, with no profile link. On the live QR, only the demo account sees "Let a demo friend scan it" (the server decides; everyone else gets a 404 and sees nothing).

### The Composer
Adapted from the 21st.dev AI prompt box. A rounded paper composer holds a speaker toggle ("Who is talking?"), an autosizing textarea (600-character cap) and one round action button. The button stays mounted and morphs between mic, stop (coral) and send (ink), so focus never drops. **Focus:** a 3px `--focus-ring` outline at a 2px offset around the whole composer whenever the textarea has keyboard focus; the lift and shadow are extras, so the ring stays under reduced motion. Above it: an "Ask Larry" / "Just us" switch, the one-tap replies between the two people (Yes, Tell me more, Your turn, Not for me) as one four-column row framed in the speaker's seat colour, in a group headed "Priya's replies". When Larry ends a reply by asking someone by name, that person becomes the speaker, so one tap answers as the person asked (tapping the other name overrides it), and, in Ask Larry mode, a separate "Questions for Larry" group (always open on wide screens, behind a "Questions" toggle on phones). Nothing scrolls sideways. "Just us" messages never call Larry, but every message is checked for crisis words on the device first, whatever the mode; a match shows Larry's fixed help reply and the helplines card with no model call. Beside the switch, "Excuse Larry" sends Larry out of the chat entirely: while it is out, a slim ink banner reads "Larry stepped out. It can't see this chat." with a "Hello Larry" button, every line goes to the people only (never sent to Larry, never in its history; in a room the server enforces this for everyone), and crisis words get only the helplines card. Hello brings Larry back fresh, with a short floating "Larry's back. Ask away!" note. The first time someone on a device taps "Just us", a one-time floating note says "Just you two now. Larry is listening, not replying." ("Just you now." in rooms).

### Chat
Chat uses the Chat bubble primitive above. When Larry steps back (three "Just us" messages in a row, two quiet replies, or about 50 seconds with no message or typing after Larry's last reply, because two people talking out loud send nothing), it says "You two seem fine without me. I'll be here if you need me." with a "Need Larry?" button. Its bubbles turn quiet and the chat column dims to the line ground (a tone change, never opacity). Tool progress shows as text beside typing dots ("Checking Qloo for games you'd both like…"). Saved steps appear as coral-ringed chips, and places appear as paper rows with "Plan this".

### Component reference
States, variants and accessibility for every shared component. "Busy" always means `aria-disabled` with the one busy style.

| Component | Variants | States | Accessibility |
|---|---|---|---|
| Button / `LinkButton` | primary, secondary, quiet; md, sm | rest, hover, press, focus, busy (`loading`), not ready yet | real button or link; focusable when busy |
| Chip | paper, table; with or without icon | unpressed, pressed, hover, focus, busy | `aria-pressed`; 48px |
| Switch | default | off, on, focus, busy | `role="switch"`, `aria-checked`, On/Off word printed |
| Segmented | md, lg; wrap, even | none chosen, chosen, focus | `radiogroup`, arrow keys |
| Field / `SelectField` | md, sm; text, select, one-time code | rest, focus, error | visible label, `aria-describedby`, `aria-invalid` |
| Dialog | sm, md; dismissible or not; `initialFocus` | open, closed | `showModal`, `aria-labelledby`, Escape, focus returns |
| Skeleton / `SkeletonGroup` | bar, block, circle, slot | loading | `aria-busy` region with a status line; shapes `aria-hidden` |
| Badge | ink, paper, outline; sm, md | static | `span` with full text |
| Stamp | outline, solid, done; sm, md; pips | static, new (dealt in) | word always printed |
| Chat bubble | larry, person | default, quiet, excused | polite live region; Larry labelled an AI |
| Face scale / `FaceMark` | scale, single mark | none, picked | `radiogroup`; words printed |
| Taste card | lg, md, sm, xs | empty slots, poster fallback, "+N more" | name as heading; posters with alt text |
| Bridge card | 2 to 5 seats | default, best fit, why open | reasons as text; "Why this?" is a button |
| Place card | md, lg | photo, fallback, meet entry | name as heading; "Plan this" button |
| Plan Ticket | standard, Match Day; `variant` panel or dialog; `afterSave` share or close | saved, place closed, shared | opener readable full-screen |
| Step kind pill | `variant` full or compact | static | word kept for screen readers in compact |
| Title badge | stage, podium, friends; sm, md, lg | earned, next, new | full sentence for screen readers |
| Glory count | inline, large | static, gain | gain announced politely |
| Mood picker | full, compact, room | none, chosen | group heading; status line |
| Signal chip | badge, action, switch | default, on, no results | full sentence; switch semantics |
| Composer | Ask Larry, Just us, excused | idle, typing, listening, busy | focus ring survives reduced motion |
| Block and Report | icon, pill | idle, confirm, busy, done | always one tap away; Dialog |
| Larry avatar | face, full; `size` xs (24px), sm (28px), md (36px, chat), lg (48px) | default, quiet | alt "Larry, an AI pal" |
| Deal-in | left, right | dealing, rested | off under reduced motion |
| Site header / session bar | site, session | default | landmark `header`, link names |
| Member card | md; empty seat | default, empty | name printed beside the seat dot |

## Do's and Don'ts

### Do:
- **Do** follow **The Earned Outside Rule.** Glory, titles, stages, quests and counts exist only for real things done in the real world: verified check-ins, times met, plans that happened. Nothing is earned in chat, by opening the app or by spending money. Nothing ever goes down, breaks, expires or is lost. There is no rarity, no random reward, no loot and no leaderboard of people's Glory. The card world stays a card world: a title is a card you earned at a place, not a currency.
- **Do** count weeks, not days: Spot and Duo weeks pause when a week is missed and never reset. There are no daily or chat streaks.
- **Do** deal: bridges and new title cards fly out once with `--ease-deal` and then rest. All motion is off under reduced motion.
- **Do** put real Qloo poster art in every window. Fall back to the title on its category colour (violet tint for Games). Fallback titles never break inside a word: when the longest word won't fit the window, it shows the category icon alone.
- **Do** show every category as colour plus its own icon or label (The Category Rule).
- **Do** keep **two kinds of username** visibly apart. The **account username** (QuietOtter42) appears on the profile only. A **place alias** (MossyLantern7) is a different anonymous name at every place, appears only on that place's podium, always beside a `MapPin` and "at Café Condi", and is re-rollable. Neither appears in chats, rooms or Open to meet.
- **Do** pass **viewer-typed data.** Every component that depends on who is looking (profile, titles, podium, friends) takes data already filtered for that viewer: owner, friend or stranger. The stranger type has no venue field at all, so the UI cannot leak what it is never passed. Filtering happens on the server (or in the device store), never with CSS or a conditional in JSX.
- **Do** label made-up people and pals as made up, and Larry as an AI, on every surface they appear.
- **Do** keep every target at least 48px with at least 8px between targets.
- **Do** end every new screen at a door: one Larry-written next step, so lists are never only lists.

### Don't:
- **Don't** add rarity, loot, random rewards, metal colours, a currency, or anything earned from chat, app opens, screen time or spending.
- **Don't** show loss: no "you lost Final Boss", no "you broke it", no countdowns, no gaps ("4 weeks"), no decay.
- **Don't** rank people by Glory, or show a stranger anyone's venues, places, times or Glory.
- **Don't** use gradient text, glass or blur, eyebrow labels above headings, emoji as icons, or bounce easing. Icons are Lucide, in one stroke. Titles avoid `Flag` and `Shield` (safety and Report use them), `Flame` (streak culture), `Trophy` and `Medal` (Sports and Players) and `Sparkles` (AI-slop shorthand).
- **Don't** set coloured text on paper for names or links. Use a marker beside the text (the Frame Rule).
- **Don't** fade text to show a state (the No Opacity Text Rule).
- **Don't** add a new hex value, alpha border (`border-ink/15` and similar), easing curve or `clamp()` in a component. Use the semantic tokens.

## Component handoff

Developer specs for every component in `src/components/**` are in [`docs/components.md`](docs/components.md). They cover layout, tokens, props, variants, every interaction state, responsive behaviour, edge cases, motion and accessibility, plus the known debt and its owners. This file stays the source of the rules. When the two disagree, fix `docs/components.md`.
