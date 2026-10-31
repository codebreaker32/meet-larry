// Gives the ONE demo/testing account (D19) a ready-made persona, its 25 cents of Larry time, and its
// 5 demo friends with two ready-made groups (next-round-queue.md, "Demo friends for judges").
//
//   npx tsx scripts/seed-demo.ts             apply (Firestore)
//   npx tsx scripts/seed-demo.ts --dry-run   say what would change, change nothing
//   add --keep-budget to leave the account's Larry time as it is
//   add --reset-groups to delete the two ready-made groups and seed them fresh (before a demo)
//   npx tsx scripts/seed-demo.ts --memory    the same seeding against the
//       in-memory database with a stand-in demo account, then print what it made (no credentials;
//       add --real to let Qloo and the model write the openings). A dev server on the in-memory
//       database seeds the demo account by itself the first time it opens its groups.
//
// Seeding is idempotent: the demo friends and groups have fixed ids, a second run changes nothing
// (Larry time aside). Each group is opened by Larry's real opening (the normal openGroup code: Qloo's
// group common ground and the witty opener); the fixed opener stands in when the model isn't there.
//
// The account is the Firebase test number in env DEMO_PHONE (.env only; set as the only test number by
// scripts/firebase-setup.ts). The number is never printed, logged or written anywhere but .env.
// It is a normal account: the server recognises it only by the verified token's phone claim
// (isDemoAccount in src/lib/account/session.ts), which lets it skip the check-in location, closed-now
// and dwell checks. This script NEVER makes up visits, Glory, titles or podium entries: those only
// come from real check-ins. "Show me on place leaderboards" stays off unless the account turns it on.
//
// Needs Application Default Credentials for the project in GOOGLE_CLOUD_PROJECT
// (`gcloud auth application-default login`, or the VM's service account).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEnv } from "node:util";
import { DEMO_SAM } from "../src/lib/demo";
import { randomAlias } from "../src/lib/alias";
import { personaFromProfile } from "../src/lib/persona";
import type { StoredAccount } from "../src/lib/db/types";
import type { SyncBlob } from "../src/lib/types/account";
import { DEFAULT_SHOW_ON_LEADERBOARDS } from "../src/lib/types/account";

// Server modules carry `import "server-only"`. The groups code also reaches client-safe modules that
// need the normal React build, so this runs WITHOUT --conditions=react-server and marks the marker
// package as loaded instead (this is a server-side script, never bundled).
{
  const req = createRequire(path.resolve(process.cwd(), "package.json"));
  const id = req.resolve("server-only");
  req.cache[id] = { id, filename: id, loaded: true, exports: {} } as NodeJS.Module;
}

const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_BUDGET = process.argv.includes("--keep-budget");
const RESET_GROUPS = process.argv.includes("--reset-groups");
const MEMORY = process.argv.includes("--memory");
const REAL = process.argv.includes("--real");

/** Qloo and model keys for Larry's openings, from ../.env when not already set. Values are never printed. */
function loadKeys() {
  const file = path.resolve(process.cwd(), "../.env");
  if (!existsSync(file)) return;
  const env = parseEnv(readFileSync(file, "utf8"));
  for (const k of ["QLOO_KEY", "QLOO_SERVER_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BUDGET_USD"]) if (!process.env[k] && env[k]) process.env[k] = env[k];
}

/** How the openings are written: real Qloo + curation + the witty opener, charged to nobody's Larry time (a one-off seed). */
async function openingDeps(real: boolean): Promise<import("../src/lib/groups/service").OpeningDeps> {
  if (!real) return { find: async () => Promise.reject(new Error("no Qloo in this run")), fixedOpener: true };
  loadKeys();
  const { findGroupCommonGround } = await import("../src/lib/qloo");
  const charge = () => undefined;
  return { find: (members, signals) => findGroupCommonGround(members, undefined, { charge, ...(signals ? { signals } : {}) }), charge };
}

async function seedWorld(repo: import("../src/lib/db/types").Repo, uid: string, real: boolean) {
  const { seedDemoWorld, DEMO_FRIENDS, DEMO_GROUPS } = await import("../src/lib/groups/demo");
  const out = await seedDemoWorld(repo, uid, { opening: await openingDeps(real), reset: RESET_GROUPS });
  if (out.already) console.log("The demo friends and ready-made groups were already there. Nothing changed (use --reset-groups to start them fresh).");
  else console.log(`Demo friends: ${DEMO_FRIENDS.map((f) => f.name).join(", ")}. Groups made: ${out.made} of ${DEMO_GROUPS.length}; opened by Larry now: ${out.opened}.`);
  return out;
}

/** --memory: the whole seeding against the in-memory database, with a stand-in demo account. */
async function memoryRun() {
  const { createMemoryRepo } = await import("../src/lib/db/memory");
  const { demoGroupId, DEMO_GROUPS } = await import("../src/lib/groups/demo");
  const repo = createMemoryRepo();
  const uid = "demo-stand-in";
  await repo.accounts.create({
    uid,
    name: "Demo",
    username: "DemoStandIn1",
    createdAt: Date.now(),
    budgetCentsLeft: BUDGET_CENTS,
    glory: 0,
    sharingWithFriends: false,
    showOnLeaderboards: DEFAULT_SHOW_ON_LEADERBOARDS,
    publicTitleCounts: {},
    dob: { d: 1, m: 1, y: 1995 },
  });
  await seedWorld(repo, uid, REAL);
  const again = await seedWorld(repo, uid, false);
  if (!again.already) throw new Error("A second run changed something");
  for (const s of DEMO_GROUPS) {
    const g = await repo.groups.get(demoGroupId(uid, s.slot));
    const lines = await repo.groupMessages.list(g!.id, { sinceAt: 0, limit: 20 });
    console.log(`\n${g!.members.map((m) => (m.isDemoFriend ? `${m.name} (Demo friend)` : m.name)).join(", ")}`);
    for (const l of lines) console.log(`  ${l.from === "larry" ? "Larry" : (g!.members.find((m) => m.id === l.from)?.name ?? l.from)}: ${l.text}`);
  }
}
const BUDGET_CENTS = 25;

function demoPhone(): string | null {
  let phone = process.env.DEMO_PHONE;
  for (const file of [path.resolve(process.cwd(), ".env.local"), path.resolve(process.cwd(), "../.env")]) {
    if (phone) break;
    if (existsSync(file)) phone = parseEnv(readFileSync(file, "utf8")).DEMO_PHONE;
  }
  return phone && /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

/** The ready-made persona: Sam's picks from the demo card, labelled as a ready-made test persona. */
function demoPersona() {
  const p = personaFromProfile({ ...DEMO_SAM, name: "Demo" });
  return {
    ...p,
    notes: ["This is the ready-made demo account's taste, for testing.", "likes calm places with board games", ...p.notes].slice(0, 20),
    placeVibe: "calm" as const,
    updatedAt: Date.now(),
  };
}

async function main() {
  if (MEMORY) return memoryRun();
  const phone = demoPhone();
  if (!phone) {
    console.error("DEMO_PHONE is not set (or not E.164) in .env. Nothing to seed.");
    process.exit(1);
  }
  const persona = demoPersona();
  if (DRY_RUN) {
    console.log("Dry run. Would make sure the demo account exists (phone from DEMO_PHONE, not shown) and give it:");
    console.log(`  - ${KEEP_BUDGET ? "its current" : `${BUDGET_CENTS} cents of`} Larry time`);
    console.log(`  - the ready-made persona with ${persona.likes.length} picks`);
    console.log("  - no visits, Glory, titles or podium entries (only real check-ins add those)");
    console.log(`  - 5 demo friends (made up, no phone) and 2 ready-made groups opened by Larry${RESET_GROUPS ? ", seeded fresh" : " (if not there yet)"}`);
    return;
  }

  const { hasApplicationDefaultCredentials, adminAuth } = await import("../src/lib/firebase/admin");
  if (!hasApplicationDefaultCredentials()) {
    console.error("No Application Default Credentials. Run `gcloud auth application-default login` first.");
    process.exit(1);
  }
  const { firestoreRepo } = await import("../src/lib/db/firestore");
  const repo = firestoreRepo();
  const auth = adminAuth();

  let uid: string;
  try {
    uid = (await auth.getUserByPhoneNumber(phone)).uid;
  } catch (err) {
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
    uid = (await auth.createUser({ phoneNumber: phone })).uid;
    console.log("Made the demo sign-in record.");
  }

  const existing = await repo.accounts.get(uid);
  if (!existing) {
    let username = randomAlias();
    for (let i = 0; i < 10 && !(await repo.usernames.claim(username, uid)); i++) username = randomAlias();
    const account: StoredAccount = {
      uid,
      name: "Demo",
      username,
      createdAt: Date.now(),
      budgetCentsLeft: BUDGET_CENTS,
      glory: 0,
      sharingWithFriends: false,
      showOnLeaderboards: DEFAULT_SHOW_ON_LEADERBOARDS,
      publicTitleCounts: {},
      // An adult date of birth, so the account passes the same 18+ rule as everyone.
      dob: { d: 1, m: 1, y: 1995 },
    };
    await repo.accounts.create(account);
    console.log(`Made the demo account ${username}.`);
  } else if (!KEEP_BUDGET) {
    await repo.accounts.update(uid, (a) => ({ ...a, budgetCentsLeft: BUDGET_CENTS }));
    console.log(`Topped up ${existing.username} to ${BUDGET_CENTS} cents of Larry time.`);
  }

  // Persona only. Steps and place counts are whatever the account really has; nothing is invented.
  const sync = await repo.sync.get(uid);
  const blob: SyncBlob = {
    persona,
    steps: sync?.steps ?? [],
    placeCounters: sync?.placeCounters ?? [],
    ageBucket: sync?.ageBucket ?? "25-34",
    ...(sync?.publicTitleCounts ? { publicTitleCounts: sync.publicTitleCounts } : {}),
  };
  await repo.sync.put(uid, blob);
  console.log(`Gave it the ready-made persona (${persona.likes.length} picks). No visits, Glory or podium entries were added.`);
  await seedWorld(repo, uid, true);
}

main().catch((err) => {
  // Never the phone number: only the error's code or message.
  console.error("Seeding the demo account failed:", (err as { code?: string }).code ?? (err as Error).message);
  process.exit(1);
});
