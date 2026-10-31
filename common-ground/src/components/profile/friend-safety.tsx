"use client";

import * as React from "react";
import { Ban, Flag, ShieldAlert } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { authFetch } from "@/lib/firebase/client";
import {
  GROUP_REPORT_REASONS,
  type GroupReportReason,
} from "@/lib/groups/shared";
import { cn } from "@/lib/utils";

// Block and Report from a friend's profile (D26: everyone has one-tap Leave / Unfriend / Block /
// Report, silent and immediate). POST /api/friends { action, username, reason? }. The server answers
// the same way whether or not they were a friend, so nothing is revealed.

export const FRIEND_REPORT_TEXT: Record<GroupReportReason, string> = {
  unsafe: "They made me feel unsafe",
  unkind: "They were rude or mean",
  underage: "I think they are under 18",
  spam: "Spam or selling something",
  other: "Something else",
};

type Step = "choose" | "block" | "report" | "done";

export async function friendAction(
  username: string,
  action: "block" | "report",
  reason?: GroupReportReason,
): Promise<boolean> {
  try {
    const res = await authFetch("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, username, ...(reason ? { reason } : {}) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function FriendSafety({
  username,
  who,
  onDone,
  className,
}: {
  username: string;
  /** How to name them: their display name. */
  who: string;
  /** After a block or report went through and the sheet closed. */
  onDone?: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("choose");
  const [reason, setReason] = React.useState<GroupReportReason | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<"block" | "report" | null>(null);

  const run = async (kind: "block" | "report") => {
    if (busy) return;
    if (kind === "report" && !reason) {
      setError("Pick what happened first.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await friendAction(
      username,
      kind,
      kind === "report" ? reason! : undefined,
    );
    setBusy(false);
    if (!ok) {
      setError("Hmm, that didn't go through. Try again in a moment?");
      return;
    }
    setDone(kind);
    setStep("done");
  };

  return (
    <>
      <Button
        variant="quiet"
        icon={<ShieldAlert />}
        className={className}
        aria-label={`Block or report ${who}`}
        onClick={() => {
          setStep("choose");
          setReason(null);
          setError(null);
          setOpen(true);
        }}
      >
        Block or report
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onClosed={() => done && onDone?.()}
        size="md"
        icon={<ShieldAlert />}
        title={
          step === "done"
            ? "Done"
            : step === "report"
              ? "Report"
              : step === "block"
                ? "Block"
                : "Keep yourself safe"
        }
      >
        {step === "choose" && (
          <div className="flex flex-col gap-3">
            <p>
              If anything feels off, tap Block. {who} leaves your Larry for good
              and is never told who did it.
            </p>
            <Button
              variant="secondary"
              onClick={() => setStep("block")}
              icon={<Ban />}
              className="justify-start"
            >
              Block
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStep("report")}
              icon={<Flag />}
              className="justify-start"
            >
              Report
            </Button>
          </div>
        )}
        {step === "block" && (
          <div className="flex flex-col gap-3">
            <p>
              You and {who} won&apos;t see each other on Larry again, in any
              group or anywhere else.
            </p>
            <Button
              loading={busy}
              onClick={() => void run("block")}
              icon={<Ban />}
            >
              Block {who}
            </Button>
            <Button variant="quiet" onClick={() => setStep("choose")}>
              Back
            </Button>
          </div>
        )}
        {step === "report" && (
          <div className="flex flex-col gap-3">
            <p>
              Tell us what happened. We keep your report for review, and block
              them for you too.
            </p>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">What happened</legend>
              {GROUP_REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "press press-soft min-h-12 rounded-tile border-2 px-4 py-2 text-left text-label",
                    reason === r
                      ? "border-ink bg-ink text-paper"
                      : "border-border-subtle bg-table text-ink hover:border-ink",
                  )}
                >
                  {FRIEND_REPORT_TEXT[r]}
                </button>
              ))}
            </fieldset>
            <Button
              loading={busy}
              aria-disabled={busy || !reason || undefined}
              onClick={() => void run("report")}
              icon={<Flag />}
            >
              Report and block
            </Button>
            <Button variant="quiet" onClick={() => setStep("choose")}>
              Back
            </Button>
          </div>
        )}
        {step === "done" && (
          <div className="flex flex-col gap-3">
            <p>
              {done === "report"
                ? `Thank you for telling us. ${who} is blocked.`
                : `${who} is blocked.`}{" "}
              You won&apos;t see each other again.
            </p>
            <Button onClick={() => setOpen(false)}>OK</Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
