import { hashAccessCode, newAccessCode } from "../src/lib/access/codes";
import { getCodeStore } from "../src/lib/access/store";

/**
 * Fresh access codes for this run, stored (hashed) in the same file the dev server reads:
 *  - E2E_CODE: a big budget, for routes that need a code (room Larry, Open to meet). Every model
 *    call in those routes is replaced by a test hook, so nothing is really spent.
 *  - E2E_SPENT_CODE: a code whose AI time is used up, for the 402 message.
 * Workers read them from process.env (set here, before any worker starts).
 */
export default async function globalSetup() {
  const live = newAccessCode();
  const spent = newAccessCode();
  const now = Date.now();
  await getCodeStore().add([
    { hash: hashAccessCode(live)!, record: { budgetCents: 10_000, spentCents: 0, createdAt: now, note: "e2e" } },
    { hash: hashAccessCode(spent)!, record: { budgetCents: 25, spentCents: 25, createdAt: now, note: "e2e-spent" } },
  ]);
  process.env.E2E_CODE = live;
  process.env.E2E_SPENT_CODE = spent;
}
