// Stage 2 design and flavour pass: the new surfaces in one folder, for the review against DESIGN.md,
// the personas and the flavour gate. Re-runs the builders' own jobs (groups, chat, home card,
// profiles), so the shots stay in step with their flows.
// Run: `SHOTS_OUT=.impeccable/review/final E2E_BASE_URL=http://localhost:3209 npx tsx e2e/review-shots.ts stage2 [job]`
// against a dev server started with NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory.
import type { ShotJob } from "./_kit";
import { jobs as home } from "./2a";
import { jobs as profiles } from "./2b";
import { jobs as groups } from "./2c";
import { jobs as badges } from "./2g";

const pick = (list: ShotJob[], names: string[]) => list.filter((j) => names.includes(j.name));

export const jobs: ShotJob[] = [
  ...pick(groups, ["new", "qr", "scan", "chat", "list"]),
  ...pick(profiles, ["group-chat"]),
  ...pick(badges, ["friend", "stranger"]),
  ...home,
];
