"use client";

import * as React from "react";
import { Ban, Flag, ShieldAlert } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { REPORT_REASON_TEXT, REPORT_REASONS, type ReportReason } from "@/lib/meet/config";
import { blockPerson, reportPerson, type SafetyTarget } from "@/lib/meet/client";
import { cn } from "@/lib/utils";

// Block and Report, one tap away (PRODUCT.md, Open to meet). Used on the meet nearby list (for a
// whole group: before a wave nobody is shown as one person), in
// meet chats, and in normal rooms (pass { room: creds, targetMemberId }).
//   Block: permanent and both ways. You never see each other again, anywhere. They aren't told.
//   Report: stored for review with the last messages, and blocks them too.

type Step = "choose" | "block" | "report" | "done";

export function BlockReport({
  target,
  who = "this person",
  variant = "icon",
  plural = false,
  onDone,
  className,
}: {
  target: SafetyTarget;
  /** How to name them in the sheet: "Sam" in a room, "this person" on the nearby list. */
  who?: string;
  /** "icon": a round shield button (lists, headers). "pill": a labelled button. */
  variant?: "icon" | "pill";
  /** `who` names more than one person ("the people in this group"). */
  plural?: boolean;
  /** Called after a block or report went through (the person is gone from view). */
  onDone?: (kind: "block" | "report") => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("choose");
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [doneKind, setDoneKind] = React.useState<"block" | "report" | null>(null);

  const openSheet = () => {
    setStep("choose");
    setReason(null);
    setError(null);
    setOpen(true);
  };
  const close = () => setOpen(false);

  const run = async (kind: "block" | "report") => {
    if (busy) return;
    if (kind === "report" && !reason) {
      setError("Pick what happened first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (kind === "block") await blockPerson(target);
      else await reportPerson(target, reason!);
      setDoneKind(kind);
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={openSheet}
          aria-label={`Block or report ${who}`}
          className={cn("press press-hard grid size-12 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper text-ink hover:bg-table", className)}
        >
          <ShieldAlert className="size-5" aria-hidden />
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={openSheet} icon={<ShieldAlert />} className={className}>
          Block or report
        </Button>
      )}

      {/* onDone runs once the sheet has closed, however it was closed (button, Escape, scrim). */}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onClosed={() => doneKind && onDone?.(doneKind)}
        size="md"
        icon={<ShieldAlert />}
        title={step === "done" ? "Done" : step === "report" ? "Report" : step === "block" ? "Block" : "Keep yourself safe"}
      >
        {step === "choose" && (
          <div className="flex flex-col gap-3">
            <p className="text-body">If anything feels off, tap Block. {capital(who)} will vanish from your Larry for good, no questions asked, and never find out who did it.</p>
            <Button variant="secondary" onClick={() => setStep("block")} icon={<Ban />} className="justify-start">
              Block
            </Button>
            <Button variant="secondary" onClick={() => setStep("report")} icon={<Flag />} className="justify-start">
              Report
            </Button>
          </div>
        )}

        {step === "block" && (
          <div className="flex flex-col gap-3">
            <p className="text-body">You and {who} won&apos;t see each other in Larry again, here or anywhere. It&apos;s for good.</p>
            <Button loading={busy} onClick={() => run("block")} icon={<Ban />}>
              Block {who}
            </Button>
            <Button variant="quiet" onClick={() => setStep("choose")}>
              Back
            </Button>
          </div>
        )}

        {step === "report" && (
          <div className="flex flex-col gap-3">
            <p className="text-body">Tell us what happened. We keep your report and the last few messages for review, and block them for you too.</p>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">What happened</legend>
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "press press-soft min-h-12 rounded-tile border-2 px-4 py-2 text-left text-label",
                    reason === r ? "border-ink bg-ink text-paper" : "border-border-subtle bg-table text-ink hover:border-ink",
                  )}
                >
                  {REPORT_REASON_TEXT[r]}
                </button>
              ))}
            </fieldset>
            {/* With no reason picked it looks unavailable but still answers, saying what to do first. */}
            <Button loading={busy} aria-disabled={busy || !reason || undefined} onClick={() => run("report")} icon={<Flag />}>
              Report and block
            </Button>
            <Button variant="quiet" onClick={() => setStep("choose")}>
              Back
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              {doneKind === "report"
                ? `Thank you for telling us. ${capital(who)} ${plural ? "are" : "is"} blocked. You won't see each other again.`
                : `${capital(who)} ${plural ? "are" : "is"} blocked. You won't see each other again.`}
            </p>
            <p className="text-body">If you&apos;d like someone with you right now, a staff member or someone you trust nearby is a good person to find.</p>
            <Button onClick={close}>OK</Button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-body text-danger">
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
