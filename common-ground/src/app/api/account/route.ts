import { deleteAccountData, publicAccount, signup, updateSettings } from "@/lib/account/service";
import { bearerToken, getSession, verifyRequest } from "@/lib/account/session";
import { E2E_TOKEN_PREFIX } from "@/lib/firebase/config";
import { getRepo } from "@/lib/db";
import { errorResponse, readJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { accountSettingsSchema, signupSchema } from "@/lib/schemas";

// /api/account (D18: Authorization: Bearer <Firebase ID token>).
//   GET     -> Account, or 401 signed out, or 404 signed in with no account yet (go to sign-up)
//   POST    SignupRequest -> Account (18+ check on the server, username must be free)
//   PATCH   AccountSettingsRequest -> Account ("Show me on place leaderboards", D12)
//   DELETE  -> { ok: true }: every server copy of the account, then the Firebase auth user
// Never returns the phone number or date of birth. Request bodies are never logged.

const NO_STORE = { "Cache-Control": "no-store" } as const;
const SIGNED_OUT = "Sign in to see your account.";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function GET(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const claims = await verifyRequest(request);
    if (!claims) return json({ error: SIGNED_OUT }, 401);
    const account = await getRepo().accounts.get(claims.uid);
    if (!account) return json({ error: "No account yet.", needsSignup: true }, 404);
    return json(publicAccount(account));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const claims = await verifyRequest(request);
    if (!claims) return json({ error: SIGNED_OUT }, 401);
    const body = signupSchema.parse(await readJsonBody(request, 4_000));
    const result = await signup(claims.uid, body);
    if (!result.ok) return json({ error: result.error, reason: result.reason }, result.status);
    return json(result.account, result.created ? 201 : 200);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const session = await getSession(request);
    if (!session) return json({ error: SIGNED_OUT }, 401);
    const change = accountSettingsSchema.parse(await readJsonBody(request, 1_000));
    const account = await updateSettings(session.uid, change);
    return account ? json(account) : json({ error: SIGNED_OUT }, 401);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    // Signed in is enough: someone turned away at sign-up can still remove their auth record.
    const claims = await verifyRequest(request);
    if (!claims) return json({ error: SIGNED_OUT }, 401);
    await deleteAccountData(claims.uid);
    // A fake e2e token has no Firebase user behind it.
    if (!bearerToken(request)?.startsWith(E2E_TOKEN_PREFIX)) {
      try {
        const { adminAuth } = await import("@/lib/firebase/admin");
        await adminAuth().deleteUser(claims.uid);
      } catch (err) {
        const code = (err as { code?: string }).code;
        // Already gone is fine. Anything else is logged by code only; the data above is deleted either way.
        if (code !== "auth/user-not-found") console.error("Could not delete the sign-in record:", code ?? "unknown");
      }
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
