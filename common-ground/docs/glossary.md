# Larry glossary

Every word Larry shows for titles, stages, Glory, moods, signals, check-ins and the people around you. Use these words exactly, in copy and in code. Icons are Lucide (`lucide-react` 1.64), always next to the word, never alone. The meaning lines for titles, stages and Glory are copied from `src/lib/titles.ts`; if one changes, change both.

**Sources:** the user's decisions in `research/next-round-queue.md`, the title registry in `research/component-specs.md` (C1), and `PRODUCT.md`. Where they differ, the user's decisions win. The code registries are `src/lib/titles.ts` (titles and stages), `src/lib/types/signals.ts` (moods and age ranges) and `src/lib/domain-style.ts` (categories).

**Who sees it** uses three viewers:
- **Owner:** you, looking at your own things.
- **Friend:** a mutual friend, and only when **both** of you have "Show my check-ins to friends" on.
- **Stranger:** anyone else. A stranger never sees venue names, places, times or Glory.

**Copy rules for every word here:** easy-read, one or two short sentences, no "·", "×", "&" or arrows as joiners, no emoji. Counts are words: "Final Boss at 2 places", not "Final Boss ×2".

---

## Stages (private)

Your own progress at one place. Counted from verified visits, one per place per day.

| Word | Visits at the place | Icon | Meaning (easy-read) | Who sees it |
|---|---|---|---|---|
| Rookie | 1 | `Sprout` | Your first visit here. | Owner only |
| Regular | 3 | `Footprints` | You've been here 3 times. | Owner only |
| Veteran | 6 | `Backpack` | You've been here 6 times. | Owner only |
| Elite | 10 | `Award` | You've been here 10 times. | Owner only |
| Legend | 20 | `MountainSnow` | You've been here 20 times. | Owner only |

Stages are private because they would reveal a routine. "Next" shows only to the owner and only when close ("Veteran is 2 visits away").

Retired words: "First visit" and "Local" (the old milestones). Don't use them.

## Public podium titles

The top 3 at one place, among everyone on Larry, by verified visits. Shown on that place's podium next to a place alias, never next to an account username.

| Word | Rank | Icon | Meaning | Who sees it |
|---|---|---|---|---|
| Final Boss | 1 | `Crown` | Most visits here of anyone on Larry. | Everyone, on the place's podium. A stranger sees only the count on a profile ("Final Boss at 2 places"), never the place |
| Guildmaster | 2 | `Castle` | Second most visits here of anyone on Larry. | Same as above |
| Shogun | 3 | `Swords` | Third most visits here of anyone on Larry. | Same as above |

Adults only. People are on a podium only if they choose to be ("Just my own progress" keeps them off). A podium opens only when enough people visit: "Podium opens when more people visit." Nobody is ever told they lost a title.

## Friend titles

The top 3 at one place among friends who both share, plus the organiser.

| Word | Rank | Icon | Meaning | Who sees it |
|---|---|---|---|---|
| Party Leader | 1 | `PartyPopper` | Most visits here among your friends. | Owner and friends who both share |
| Squad Captain | 2 | `ShipWheel` | Second most visits here among your friends. | Same |
| Crew Leader | 3 | `Anchor` | Third most visits here among your friends. | Same |
| Host | — | `HandPlatter` | Made the most plans here that friends came to. | Same |

**Rivalry line:** shown only to the person who could gain, only between friends who both share: "1 visit until you take Party Leader from Priya." Never a message to the friend who might lose it.

## Glory

| Word | Icon | Meaning | Who sees it |
|---|---|---|---|
| Glory | `Sun` | Earned by real visits. It never goes down. | Owner. Friends who both share. Never strangers |

How Glory is earned (never from chat, app opens or spending):

| Action | Glory |
|---|---|
| A verified visit | +10 |
| "I said hi" (honour tap on leaving) | +5 |
| A plan both people came to (coming later) | +20 |
| Meeting a friend there (coming later) | +15 |

Copy: "312 Glory", "+10 Glory". Glory is separate from titles. There is no leaderboard of Glory.

## Weeks, quests and places

| Word | Icon | Meaning | Who sees it |
|---|---|---|---|
| Spot weeks | `MapPinCheck` | Weeks you visited the same place. A missed week pauses the count; it never resets. Copy: "3 Saturdays at Café Condi." (not "in a row") | Owner only |
| Times we've met (Duo weeks) | `Handshake` | How often two friends actually met. A count, no dates. Coming later | The two friends |
| Our Spot | `Handshake` | A place where two friends met 3 times. Coming later | The two friends |
| Quest | `Route` | A real-world goal for the month, done only by verified visits: "Try 3 calm places this month." Kind words: Return, Explore, With a friend, Match day | Owner only |
| Places collection | — | Your private set of places you've been, with your stage at each | Owner only |

## Check-in words

| Word | Icon | Meaning |
|---|---|---|
| I'm here (Arrive) | `MapPinCheck` | The first tap at a place. One location fix. |
| I'm heading off (Leave) | `DoorOpen` | The second tap. The visit counts if you stayed 20 minutes or more, within about 150 m. |
| Counted (verified visit) | `BadgeCheck` | Both taps passed. It adds to your stage, Glory and quests. "Counted. That's visit 3 at Café Condi." |
| Visited | — | A visit without a matching Leave. It shows in your places collection but adds no stage or Glory. "You still went, and that's the part that counts." |
| I said hi | `Hand` | An honour tap on leaving, for a hello you said. |
| Simulated location | — | Shown on screen whenever a demo uses a made-up location. |

## Guess vs Reality (face scale)

Five faces, each with its word, from `FACES` in `src/components/ui/face-scale.tsx`. The scale is never colour-coded.

| Value | Word | Icon |
|---|---|---|
| 1 | Awful | `Frown` |
| 2 | Not great | `FaceSlightlyFrowning` |
| 3 | OK | `FaceNeutral` |
| 4 | Good | `FaceSlightlySmiling` |
| 5 | Great | `FaceGrinning` |

Questions: "How do you think it'll go?" (before) and "How did it go?" (after), then "Glad you went?" Yes (`ThumbsUp`), Meh (`FaceNeutral`), No (`ThumbsDown`). The comparison shows only when it went as well or better: "You guessed Not great. It was Good." Guess and reality stay on the device.

## Moods

One tap, optional, changeable any time. Stored on the device and never shown to strangers, on a profile, or by name in a room.

| Word | Icon | Meaning line (shown when chosen) | What Larry does |
|---|---|---|---|
| Chill | `Armchair` | Calm and close by. No rush. | Calm places, short distance |
| Social | `MessagesSquare` | Up for people today. | Cosy to lively places, events with people built in |
| Curious | `Telescope` | Show me something I don't know. | Hidden gems and less-known Qloo picks |
| Low energy | `BatteryLow` | Short, gentle and easy. | Same rung, a shorter visit, shorter plan words |
| Hype | `Zap` | Bring the noise. | Lively places, match days, trending picks |

Rooms show only Larry's blended line: "Two of you feel chill, so a quiet board-game café."

## Age ranges

"How old are you?" 13–17, 18–24, 25–34, 35–44, 45+. Never a birthday on the card. Never shown to anyone. Under 18: no Open to meet, rooms only by invite code, no podium, rivalry or nudges.

## Qloo signals

| Word | Icon | Meaning | Where |
|---|---|---|---|
| Hidden gems only | `Gem` | A switch: show less-known picks. Badge: "Hidden gem". | Talk taste, bridges |
| Taste Fingerprint | `Fingerprint` | How your taste compares with everyone's, from real Qloo scores: "72% off the beaten path. Strongest in Games and Music." | Back of the taste card, /me |
| Taste Twin | `Blend` | Your taste in one category carried into another, as a sentence: "Your Minecraft side, in music: beabadoobee." | Talk taste, /me |
| Match Day | `Goal` | A real upcoming game for a team you share. Badge: "Match day: Sat". | Bridges, the Match Day Plan Ticket |
| Rising | `TrendingUp` | Trending near you this week, with Larry's line. "Rising in Mumbai this week". | Landing strip, bridge badge |
| Where your people are | `Map` | The areas where your shared taste is strongest, ranked, from Qloo's heatmap. Areas only, never people. | Plan Ticket, next rung |

A signal with no real data behind it is hidden, never faked.

## Names and people

| Word | Meaning | Where it shows |
|---|---|---|
| Account username | Your public name, like QuietOtter42, chosen at sign-up from the generator. Real names are not allowed. | Your profile only |
| Place alias | A different anonymous name at every place, like MossyLantern7. Re-rollable. Always shown beside a `MapPin` and "at Café Condi". | That place's podium only. Never in chats, rooms, Open to meet or a profile others see |
| Display name | Your real first name. | Friends only |
| Practice character | A made-up partner with real Qloo tastes, labelled "made up" (Maya, Leo, Aisha, Kenji). | Practice and warm-up |
| Larry (AI pal) | The AI. Always labelled an AI where it speaks. | Everywhere it speaks |

## Core words

| Word | Meaning |
|---|---|
| Taste card | Your favourites as a trading card, made by tapping pictures. |
| Common ground | What two (or more) people's tastes share. |
| Bridge | Something both tastes point to, with a reason for each person. |
| First Step | One small real-world task, in one of three kinds: Go (`MapPin`), Say (`MessageCircle`) or Show (`Eye`). Kinds are neutral pills, never a category colour. |
| Plan Ticket | One real plan: where, when, an if-then line, the opener and a plan B. |
| If-then line | "If it's busy, then we sit outside." Larry writes it with you. |
| Opener | The first line to say or show. It opens full-screen so it can be shown instead of said. |
| Ladder, rung | Places from quiet to lively. The next rung is a little livelier. |
| Calm, Cosy, Lively | How a place feels (vibe chips, `Leaf`, `Coffee`, `Users`). They describe places, never people. |
| Larry's next move | The one card on the home page with your next real step. |
| Open to meet | Meeting a stranger who shares your taste, only at the same public place, both adults, both checked in, both wave. |
| Wave | Saying "I'd like to meet" in Open to meet. A chat opens only when both wave. |
| Block, Report | Block hides someone from you everywhere, for good. Report flags them for review. Both one tap away. |
| Ask Larry, Just us | Whether Larry replies in the chat or just listens. |
| Excuse Larry, Hello Larry | Send Larry out of the chat completely, and bring it back. |
| Larry time | Each account's budget of AI use (25¢). "That's your Larry time for now! Everything else still works." |
| Just my own progress | A switch on /me that keeps you off podiums and rivalry lines. |
| Show my check-ins to friends | A switch on /me, off by default. Friends see your places and titles only when both of you have it on. |
| Plain words | A setting that hides Larry's witty lines and keeps the plain ones. |

## Words we don't use

| Don't say | Say instead | Why |
|---|---|---|
| streak, in a row | "3 Saturdays at Café Condi" | Weeks pause, so "in a row" would be untrue |
| you lost, you broke it, you failed | nothing; titles change quietly | No loss messages, ever |
| points, XP, level, rank (for Glory) | Glory | One score, never ranked between people |
| First visit, Local | Rookie, Regular | Retired milestone words |
| Final Boss ×2 | Final Boss at 2 places | Easy-read: no symbols as joiners |
| lonely without you, 4 weeks | "MI play Saturday. Same calm café?" | Nudges name a real event or real progress, never a gap or a feeling |
| warning, danger, violation, ban | positive-first wording | Warm safety voice |
