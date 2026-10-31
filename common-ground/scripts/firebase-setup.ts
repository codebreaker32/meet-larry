// Sets up Firebase for Larry. Safe to run again: every step checks first.
//
//   npx -y tsx scripts/firebase-setup.ts                 apply everything
//   npx -y tsx scripts/firebase-setup.ts --dry-run       show what would change, change nothing
//   npx -y tsx scripts/firebase-setup.ts --domain your-host.example.com   also authorize a deploy domain
//   add --quiet to skip printing the web config
//
// Steps:
//   1. Phone sign-in: SMS to India (+91) only, so an open sign-up page cannot be used for SMS pumping.
//   2. Exactly one test phone number (no SMS, no cost): the demo account from DEMO_PHONE and DEMO_CODE
//      in .env. Any other test number is removed. Skipped with a warning when they are not set.
//   3. Authorized domains for phone sign-in (localhost and the Firebase hosts are kept).
//   4. Firestore rules from firestore.rules (deny every client read and write; data goes through
//      server routes with firebase-admin).
//   5. Prints the public web config as NEXT_PUBLIC_FIREBASE_* lines for .env and the server env.
//      These values ship in the browser bundle anyway; they are not secrets.
//
// The project and web app come from GOOGLE_CLOUD_PROJECT (or --project) and NEXT_PUBLIC_FIREBASE_APP_ID,
// read from the environment or .env; the repo names neither.
//
// Auth: `gcloud auth print-access-token` for the active gcloud account (or FIREBASE_SETUP_TOKEN).
// Never changes the gcloud config. Never prints tokens or the project's password-hash settings.
// Firestore itself is created once with:
//   gcloud firestore databases create --location=asia-south1 --type=firestore-native --project "$GOOGLE_CLOUD_PROJECT"
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/** A value from the environment, else from .env.local or ../.env (tsx does not load .env itself). */
function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  for (const file of [path.resolve(process.cwd(), ".env.local"), path.resolve(process.cwd(), "../.env")]) {
    if (!existsSync(file)) continue;
    const value = parseEnv(readFileSync(file, "utf8"))[key];
    if (value) return value;
  }
  return undefined;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (put it in .env or the environment)`);
  return value;
}

const PROJECT = required("GOOGLE_CLOUD_PROJECT", arg("--project") ?? envValue("GOOGLE_CLOUD_PROJECT"));
const WEB_APP_ID = required("NEXT_PUBLIC_FIREBASE_APP_ID", envValue("NEXT_PUBLIC_FIREBASE_APP_ID"));
const DRY_RUN = process.argv.includes("--dry-run");

/** SMS goes to India only. */
const SMS_REGIONS = ["IN"];

/**
 * The one demo/testing account (D19): a Firebase test number with a fixed code, so no SMS is ever
 * sent. Both values live only in .env (DEMO_PHONE, DEMO_CODE), never in the repo, and are never printed.
 */
function demoNumber(): { phone: string; code: string } | null {
  const phone = envValue("DEMO_PHONE");
  const code = envValue("DEMO_CODE");
  if (!phone || !code) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code)) {
    throw new Error("DEMO_PHONE must be E.164 (+<country><number>) and DEMO_CODE six digits");
  }
  return { phone, code };
}

const BASE_DOMAINS = ["localhost", `${PROJECT}.firebaseapp.com`, `${PROJECT}.web.app`];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

function token(): string {
  if (process.env.FIREBASE_SETUP_TOKEN) return process.env.FIREBASE_SETUP_TOKEN;
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

const TOKEN = token();

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      // User credentials need a quota project for these APIs.
      "x-goog-user-project": PROJECT,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // keep the raw text
    }
    throw new Error(`${method} ${url.split("?")[0]} -> ${res.status}: ${message}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const log = (msg: string) => console.log(`[firebase-setup] ${msg}`);

/* ---------------------------------------------------------------- auth config */

interface AuthConfig {
  signIn?: { phoneNumber?: { enabled?: boolean; testPhoneNumbers?: Record<string, string> } };
  authorizedDomains?: string[];
  smsRegionConfig?: { allowlistOnly?: { allowedRegions?: string[] }; allowByDefault?: unknown };
}

async function setupAuth(extraDomains: string[]) {
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  const cfg = await api<AuthConfig>("GET", url);

  if (!cfg.signIn?.phoneNumber?.enabled) {
    log("WARNING: phone sign-in is not enabled. Turn it on in the Firebase console (Authentication, Sign-in method).");
  }

  const currentNumbers = cfg.signIn?.phoneNumber?.testPhoneNumbers ?? {};
  const demo = demoNumber();
  if (!demo) log("WARNING: DEMO_PHONE / DEMO_CODE not set; leaving the test numbers as they are.");
  const numbers: Record<string, string> = demo ? { [demo.phone]: demo.code } : currentNumbers;
  const currentKeys = Object.keys(currentNumbers);
  const numbersChanged =
    !!demo && (currentKeys.length !== 1 || currentNumbers[demo.phone] !== demo.code);

  const currentDomains = cfg.authorizedDomains ?? [];
  const domains = [...new Set([...currentDomains, ...BASE_DOMAINS, ...extraDomains])];
  const domainsChanged = domains.length !== currentDomains.length;

  const currentRegions = cfg.smsRegionConfig?.allowlistOnly?.allowedRegions ?? [];
  const regionsChanged =
    !cfg.smsRegionConfig?.allowlistOnly ||
    currentRegions.length !== SMS_REGIONS.length ||
    SMS_REGIONS.some((r) => !currentRegions.includes(r));

  const mask: string[] = [];
  const body: AuthConfig = {};
  if (numbersChanged) {
    mask.push("signIn.phoneNumber.testPhoneNumbers");
    body.signIn = { phoneNumber: { testPhoneNumbers: numbers } };
  }
  if (domainsChanged) {
    mask.push("authorizedDomains");
    body.authorizedDomains = domains;
  }
  if (regionsChanged) {
    mask.push("smsRegionConfig");
    body.smsRegionConfig = { allowlistOnly: { allowedRegions: SMS_REGIONS } };
  }

  // Counts only: the demo number and its code are never printed.
  log(`test numbers: ${currentKeys.length} -> ${Object.keys(numbers).length} (${numbersChanged ? "replacing" : "already set"})`);
  log(`authorized domains: ${domains.join(", ")} (${domainsChanged ? "updating" : "already set"})`);
  log(`SMS regions: ${SMS_REGIONS.join(", ")} only (${regionsChanged ? "setting" : "already set"})`);

  if (!mask.length || DRY_RUN) return;
  await api("PATCH", `${url}?updateMask=${mask.join(",")}`, body);
  log("auth config updated");
}

/* ---------------------------------------------------------------- firestore rules */

interface Ruleset {
  name: string;
  source?: { files?: { name: string; content: string }[] };
}

async function setupRules() {
  const file = path.resolve(process.cwd(), "firestore.rules");
  const content = readFileSync(file, "utf8");
  const base = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
  const releaseName = `projects/${PROJECT}/releases/cloud.firestore`;

  let current: { rulesetName?: string } | null = null;
  try {
    current = await api<{ rulesetName?: string }>("GET", `https://firebaserules.googleapis.com/v1/${releaseName}`);
  } catch (e) {
    if (!String(e).includes("404")) throw e;
  }
  if (current?.rulesetName) {
    const live = await api<Ruleset>("GET", `https://firebaserules.googleapis.com/v1/${current.rulesetName}`);
    if (live.source?.files?.some((f) => f.content === content)) {
      log("Firestore rules: already live");
      return;
    }
  }
  log(`Firestore rules: ${current ? "replacing" : "creating"} release from firestore.rules`);
  if (DRY_RUN) return;

  const ruleset = await api<Ruleset>("POST", `${base}/rulesets`, {
    source: { files: [{ name: "firestore.rules", content }] },
  });
  if (current) {
    await api("PATCH", `https://firebaserules.googleapis.com/v1/${releaseName}`, {
      release: { name: releaseName, rulesetName: ruleset.name },
    });
  } else {
    await api("POST", `${base}/releases`, { name: releaseName, rulesetName: ruleset.name });
  }
  log(`Firestore rules: live (${ruleset.name.split("/").pop()})`);
}

/* ---------------------------------------------------------------- web config */

interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  storageBucket?: string;
}

async function printWebConfig() {
  const cfg = await api<WebConfig>(
    "GET",
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps/${WEB_APP_ID}/config`,
  );
  // No measurementId: the app does not use the Analytics SDK.
  console.log(
    [
      "",
      "# Firebase web config (public; inlined into the browser bundle at build time)",
      `NEXT_PUBLIC_FIREBASE_API_KEY=${cfg.apiKey}`,
      `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${cfg.authDomain}`,
      `NEXT_PUBLIC_FIREBASE_PROJECT_ID=${cfg.projectId}`,
      `NEXT_PUBLIC_FIREBASE_APP_ID=${cfg.appId}`,
      `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId}`,
    ].join("\n"),
  );
}

async function main() {
  log(`project ${PROJECT}${DRY_RUN ? " (dry run: nothing changes)" : ""}`);
  await setupAuth(args("--domain"));
  await setupRules();
  if (!process.argv.includes("--quiet")) await printWebConfig();
}

main().catch((e: unknown) => {
  console.error(`[firebase-setup] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
