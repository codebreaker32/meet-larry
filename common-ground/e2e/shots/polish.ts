// Polish pass: the key screens in one folder, for the design review (landing, home and the next-move
// popup, the taste card, groups by QR with the @Larry menu, the Plan Ticket, check-in and the Glory
// moment, the three profile views, a place podium, Talk taste, Pick a pal and sign-up).
// Re-uses each builder's own jobs so the shots follow their flows.
// Run: `E2E_BASE_URL=http://localhost:3311 npx tsx e2e/review-shots.ts polish [job]` against a dev
// server started with NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory.
import type { ShotJob } from "./_kit";
import { jobs as plans } from "./1a";
import { jobs as checkins } from "./1b";
import { jobs as talk } from "./1c";
import { jobs as accounts } from "./1f-accounts";
import { jobs as home } from "./2a";
import { jobs as groups } from "./2c";
import { jobs as badges } from "./2g";
import { jobs as a11y } from "./stage0-a11y";

const pick = (list: ShotJob[], names: string[]) => list.filter((j) => names.includes(j.name));

export const jobs: ShotJob[] = [
  ...pick(home, ["landing", "home-group", "home-checkin"]),
  ...pick(a11y, ["create", "card", "practice", "me"]),
  ...pick(groups, ["new", "qr", "scan", "chat", "list"]),
  ...pick(plans, ["ticket"]),
  ...pick(checkins, ["here", "counted", "places"]),
  ...pick(badges, ["stranger", "friend", "owner", "place"]),
  ...pick(talk, ["talk"]),
  ...pick(accounts, ["signup"]),
];
