// Review screenshots (not a test). Loads every e2e/shots/*.ts file (files starting with "_" are
// helpers) and runs its `jobs` at each width. Each builder adds its own e2e/shots/<builder>.ts
// exporting `jobs: ShotJob[]` (see e2e/shots/_kit.ts); this loader and the kit are not edited again.
//
//   npx tsx e2e/review-shots.ts                 every file, every job
//   npx tsx e2e/review-shots.ts round5          one file
//   npx tsx e2e/review-shots.ts round5 meet     one job in one file
//
// Screenshots go to .impeccable/review/<file name>/<job shot>-<width>.png. A dev server must be
// running on E2E_BASE_URL (default http://localhost:3000).
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { CHROME, DEFAULT_WIDTHS, makeKit, type ShotJob } from "./shots/_kit";

const SHOTS_DIR = path.join(__dirname, "shots");
/** SHOTS_OUT puts the screenshots somewhere else (for a dry run). */
const OUT_ROOT = process.env.SHOTS_OUT ?? path.join(__dirname, "../.impeccable/review");

/** The shot files to run, by name without ".ts". */
export function shotFiles(only?: string): string[] {
  return readdirSync(SHOTS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .map((f) => f.slice(0, -3))
    .filter((name) => !only || name === only)
    .sort();
}

async function main() {
  const [onlyFile, onlyJob] = process.argv.slice(2);
  const files = shotFiles(onlyFile);
  if (!files.length) {
    console.error(`No shot file named "${onlyFile}" in e2e/shots/`);
    process.exitCode = 1;
    return;
  }
  const browser = await chromium.launch({ executablePath: CHROME });
  let failed = 0;
  try {
    for (const file of files) {
      const mod = (await import(pathToFileURL(path.join(SHOTS_DIR, `${file}.ts`)).href)) as { jobs?: ShotJob[] };
      if (!Array.isArray(mod.jobs)) {
        console.error("SKIPPED", file, "(exports no jobs)");
        continue;
      }
      const outDir = path.join(OUT_ROOT, file);
      mkdirSync(outDir, { recursive: true });
      const kit = makeKit(browser, outDir);
      for (const job of mod.jobs) {
        if (onlyJob && job.name !== onlyJob) continue;
        for (const w of job.widths ?? DEFAULT_WIDTHS) {
          try {
            await job.run(kit, w);
          } catch (err) {
            failed++;
            console.error("FAILED", `${file}/${job.name}`, w, (err as Error).message.split("\n")[0]);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

if (require.main === module) void main();
