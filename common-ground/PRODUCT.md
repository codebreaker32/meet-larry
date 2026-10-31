# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Primary:** people with social anxiety who want to connect but freeze, especially lonely or bored 19-year-olds with no one to talk to.
- **Also:** people with speech difficulties (e.g. a stammer) or Down syndrome, for whom speaking or long text is the hard part.
- **Situation:** two people physically together (common room, class, event), one phone between them. The second person often has never heard of the app.
- **Underlying need:** the barrier is internal, a feeling of not fitting in or not belonging, not other people.

## Product Purpose
Larry helps two people who just met find real common ground through shared taste (films, TV, music, games, books, sport, podcasts, brands, travel and people), start talking, and turn it into a small real-world plan. Success means people need the app less over time: a person completes real-world First Steps and verified visits, not app sessions.

## Positioning
Taste is grounded, not guessed. Every recommendation comes from Qloo's taste graph (what real people who like X also like) with a reason attached ("because Sam likes Minecraft and Priya likes folk music"). Unlike a chatbot companion, Larry sits between two humans and steps back once they're talking.

## Operating Context
- Qloo Agentic Hackathon submission ("Agents, but with taste."). Judged equally on technical implementation, design, potential impact and quality of idea, plus "would it work as well without Qloo?". Requires a public hosted demo, a public repo with an OSS license, and a description.
- Flow: make a taste card by tapping pictures → share it as a QR code → the other person scans it (no install, no sign-up) and taps a few favourites → a pair session on one phone shows common ground and a shared chat with Larry → the session ends with a shared First Step or an if-then Plan Ticket.

## Capabilities and Constraints
- **v1:** taste card + QR, scan/join, common-ground result, shared chat on one phone (tap your name, then type, tap a quick reply, or use the mic for speech-to-text only), First Step list, nearby low-pressure places.
- **v2 (if time permits):** real-time voice with Larry. Not in v1: the AI speaking aloud, voice identification. Strangers connect only through **Open to meet** (see below).
- **No accounts (superseded 30 Oct 2026):** this used to be a hard rule. The user has since chosen phone-verified accounts for adults; see **Accounts** below. What survives from it: nobody needs an account to make a card, pair, join, use a room or save a Plan Ticket, and a card still travels inside its QR link.
- **Terminology:** "taste card", "common ground", "bridge" (a recommendation both tastes point to), "First Step" (a real-world task: go / say / show), "Plan Ticket", "check-in", "stage", "title", "Glory", "podium". Every title, stage, mood and signal word, with its meaning, icon and who sees it, is in `docs/glossary.md`. That file is the single source for these words.
- **Later ideas** (Honest Companion solo chat, Rehearsal Room) are not in v1.

## Brand Commitments
- **Name:** "Larry" (user's choice; kept in one constant so it can be renamed). Larry is also the facilitator's name in chat.
- **Voice:** short, warm, plain, easy-read. Larry is honest that it is an AI and never claims feelings or tastes of its own.
  - **Witty and specific, never generic** (user decision): Larry writes fresh lines from the real shared items ("Somebody nearby has also cried at Coco. Twice, probably."). Lines are grounded only in Qloo-found items, real places and real progress, are anonymous (no names, looks, gender or age), kind, and carry no invented trivia. A fixed fallback set covers model failure.
  - **Every witty line has a plain line beside it** (R6): "Someone here likes Spirited Away too." A "Plain words" setting keeps only the plain line.
  - **Warm safety and system copy** (user decision): every banner, error, limit and safety note is positive first (what people can do and what's protected), uses no fear words (warning, danger, violation, ban), is one or two easy-read sentences, and never hides a real limit. Crisis help stays calm and caring.
- **Binding user direction:** stay true to the design principles and avoid generic "AI slop" UI.
- **Motto:** "Talk to someone, not something." (user's choice). The pitch centres on reaching a real person, not on shared taste or the AI. The user rejected "Find what you both love" and "Make the first hello easier".

## Evidence on Hand
- Live Qloo results verified 2026-10-29: Spirited Away → Zelda: Breath of the Wild (affinity 0.885) in video games, and place insights near a location return cafés and hangouts.
- Research summary: `../research/guided-session-ideas.md` (Meta-Gallup loneliness 19–29 at 27%; OpenAI×MIT heavy-chatbot-use findings; Sun & Taylor 2020 RCT on displaying commonalities).
- No testimonials, users or metrics exist. Do not fabricate any. Practice pals are labelled as made-up wherever they appear.

## Accounts (user decision, 30 Oct 2026; supersedes "No accounts")
- **Who:** accounts are for adults (18+), because of India's DPDP rules on minors' data. Under-18s use Larry on their own device without an account, and without Open to meet.
- **Sign up:** name, username, date of birth, and a phone number verified by SMS code (Firebase phone auth). The phone number is the unique id.
  - The username is a made-up, public-safe name like QuietOtter42 (no "u/" prefix), pre-filled by a generator with a "New name" button, so nobody has to invent one under pressure. Real names are not allowed as usernames.
  - Date of birth is three large selects (day, month in words, year), never a typed date. It is used only for the 18+ check: "To check you're 18 or over. Nobody sees it."
  - Sign-up shows plainly what is stored before the phone field: the username is shown; name, phone and date of birth are never shown to anyone.
- **Ask only when needed** (R5): never gate card, pair, join, room or Plan Ticket behind an account. Offer it at the first moment that needs one: Open to meet, Glory, friends, or "keep my progress if I change phones".
- **Budget:** each account gets 25¢ of Larry time, replacing access codes. When it runs out: "That's your Larry time for now! Everything else (your card, places, plans) still works."
- **Sync:** persona, steps and check-in counts sync to the account. Check-ins sync as **folded counts only** (place, visits, stage, Spot weeks), at most once a day and never fired by the leave tap. No arrive or leave times, and no week-by-week history, ever leave the device. The privacy line is **"We keep counts, not a diary."**
- **One demo/testing account (D19 revised):** a single account on a Firebase test phone number, recognised only on the server (its verified phone number matches `DEMO_PHONE`). It skips the location, closed-now and 20-minute checks so the check-in loop can be shown anywhere. Its visits count like real ones: real Glory, and a real podium only if its own leaderboard switch is on. No label, no demo flag, no privacy exemption. The number and code live only in `.env`.
- **Deletion:** account data is deletable from the app in one place: account, username, synced data, profile, friend links, invites, group memberships and podium entries.

## Age (user decision, 30 Oct 2026)
- **Asked once** at card creation: "How old are you?" as ranges 13–17, 18–24, 25–34, 35–44, 45+. Never a birthday on the card. Minimum age 13; under-13s get a kind exit. Editable on /me. For signed-in adults the date-of-birth bucket overrides the card's answer, so the two never disagree.
- **Uses:** Qloo's age signal (the coarse bucket only), audience features near the person's age, and age-appropriate suggestions for teens.
- **Safety:**
  - Under 18: no Open to meet at all, rooms only by invite code, and no podium, rivalry, Duo count or nudges.
  - 18+: Open to meet unlocks, still with the explicit confirmation ("Open to meet is for 18+. Quick check, and you're in.").
- **Privacy:** stored on the device, and only the coarse bucket is sent with the person's own requests. Never shown to anyone: not in rooms, Open to meet or profiles.

## Mood (user decision, 30 Oct 2026)
- One tap, changeable any time, and optional: Chill, Social, Curious, Low energy, Hype. Larry uses it with the persona to move place vibe, recommendations and plan wording (gentler and shorter for Low energy).
- Rooms show only Larry's blended line from counts ("Two of you feel chill, so a quiet board-game café"), never anyone's mood by name.
- Stored on the device and sent only with that person's own requests. Never shown to strangers, never on a profile, and Open to meet chats get no mood.

## Open to meet (user decision, 30 Oct 2026)
Strangers may connect only when ALL of these hold: both are 18+ (confirmed at opt-in); both have a verified check-in at the same public venue and switched on "Open to meet"; Larry finds something real they share (Qloo); both wave (mutual consent). Then a chat room opens with Larry in it; any meeting is suggested only in that public venue.
**No stalking possible (hard requirement):**
- Nobody can see anyone's location, venue history, schedule or "last seen". No maps of people. Area maps ("Where your people are") show Qloo taste areas only, never people, and are never used in Open to meet.
- Before a mutual wave, others see only an anonymous count ("2 people here like Ghibli"): no name, photo, card or profile. A count of 0 or 1 is never shown.
- Visibility exists only while checked in AND Open to meet is on; it switches off on leaving or after 3 hours.
- Check-in stages (Rookie, Regular, Veteran, Elite, Legend) are private to the person: they would reveal routines.
- Block hides you from that person everywhere, permanently; Report flags them for review. Both are always one tap away.
- Profiles: strangers see a username and public title counts only ("Final Boss at 2 places") with NO venue names, places or times; only mutual friends who both share see which venue a title is at. Venue podiums use a different anonymous place alias per place, so they can't be linked to a profile.
- Podium aliases come from a secret key that only the device holds, so knowing someone's alias never lets anyone move or add to their count. The database never stores which account owns which place alias. The server does see both for a moment during a verified leave (for the 18+ check), so we say "the database can't join them", not "the server cannot".
- One wave per person per venue visit; waves are rate-limited; no way to follow someone between venues.
- Larry watches the chat for red flags (asking for addresses or money, pressure to move somewhere private, age or contact pressure) and steps in.

## Good addiction (user decision, 30 Oct 2026)
Larry should be addictive only for the real world, never for chat:
- **Chat** is never addictive: short, capped, Larry steps back, no endless conversation, no feeds.
- **The real world** is meant to be compelling:
  - **Glory:** one lifetime score ("312 Glory") earned only by verified real-world actions (a verified visit, an honour-tap "said hi", and later times met with a friend and plans both people attended). Never from chat or app opens. It never goes down. It is separate from titles.
  - **Titles** collected at places, counted from strict verified check-ins (arrive and leave 20+ minutes apart within about 150 m of the Qloo place, no driving-speed jumps, one per place per day):
    - private stages: Rookie (1 visit) → Regular (3) → Veteran (6) → Elite (10) → Legend (20)
    - the public podium at each place: Final Boss / Guildmaster / Shogun
    - among friends who both share: Party Leader / Squad Captain / Crew Leader, plus Host (most plans there that friends actually attended)
  - quests ("Try 3 calm places this month", "Watch a match with a friend", "Climb one rung"), completed only by verified check-ins
  - friendly rivalry among friends, shown only to the person who could gain ("1 visit until you take Party Leader from Priya"), never as "you lost"
  - seasonal events (match days, rising picks)
  - a private collection of the places you've been, with your stage at each
  - **Spot weeks and Duo weeks:** weeks at the same place, and weeks two friends actually met. Counted in weeks, never days. A missed week pauses the count; it never resets. Copy says "3 Saturdays at Café Condi", not "in a row".
- **Healthy rules:**
  - Rewards come only from real check-ins at the place, never from screen time.
  - No punishment or loss-aversion for missing a week. No "you broke it" or "you lost" messages, ever.
  - Nothing pushes spending money; free places count the same.
  - Nudges are opportunity-first and capped: at most 1 a day in total, at most 1 a week per friend or place, quiet hours 21:00–09:00, fewer as the person progresses, plus 1 reminder per accepted plan. Every nudge names a real event or real progress and points to a real-world action, never a gap or a place's feelings.
  - A person can keep it all private: "Just my own progress" keeps them off podiums and out of rivalry lines.
  - The no-stalking rules always apply.

## Product Principles
0. **The Larry test (user's rule):** if a feature would work just as well without Larry, the agent, it's of no use. Every feature must need Larry to actually do something: find what people share, move the conversation along, pick a real next step, or speak for someone who finds speaking hard. A feature that is only a form, a list or a chat window fails this test. Apply it alongside the judges' "would it work without Qloo?" test. A deterministic template is allowed only as the fallback when the model fails or the budget is spent, and every new screen ends at a door: one Larry-written next step.
1. **Real world first:** every session ends by pointing outward, and success is measured in First Steps and verified visits, not time in the app.
2. **Grounded, not guessed:** taste claims come from Qloo with a reason, or Larry says it doesn't know.
3. **Never addictive to the screen:** no feeds, no infinite chat, no daily or chat streaks; weekly real-world counts pause instead of breaking. Larry goes quiet when people talk to each other.
4. **Nobody is "thrown out":** easy-read, picture-first, and every action can be done by tapping alone.
5. **About the two people, not the app.**

## Accessibility & Inclusion
WCAG 2.2 AA minimum. Easy-read language (short sentences, plain words). Large tap targets (≥48px). Picture-first input. Every action is possible by tapping alone, without speech or typing. Speech-to-text as an option. Respects reduced motion. High-contrast text. Atkinson Hyperlegible typeface already chosen for legibility.
