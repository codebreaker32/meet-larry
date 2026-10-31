"use client";

import * as React from "react";
import { ExternalLink, LifeBuoy } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { buttonStyles } from "@/components/link-button";
import { Dialog } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Opens the help sheet. One per page; the trigger and any in-chat help card share it. */
export interface HelpHandle {
  open: () => void;
}

/** "Need help now?": always one tap away in a pair session. Larry is not a crisis service. */
export const HelpDialog = React.forwardRef<HelpHandle>(function HelpDialog(_, ref) {
  const [open, setOpen] = React.useState(false);
  React.useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      icon={<LifeBuoy />}
      title="Need help now?"
      description={
        <>
          {APP_NAME} is an AI. It can&apos;t help in a crisis the way a person can. You matter, and you don&apos;t
          have to handle this alone.
        </>
      }
    >
      <ul className="flex flex-col gap-3 text-body">
        <li className="rounded-tile bg-table p-3">
          <strong>In danger right now?</strong> Call your local emergency number.
        </li>
        <li className="rounded-tile bg-table p-3">
          <strong>Talk to someone you trust.</strong> A friend, family member, teacher or doctor.
        </li>
        <li className="rounded-tile bg-table p-3">
          <strong>Call a free helpline.</strong>
          <span className="mt-1 block">India: Tele-MANAS 14416</span>
          <span className="block">UK and Ireland: Samaritans 116 123</span>
          <span className="block">USA: 988</span>
        </li>
      </ul>
      <a
        href="https://findahelpline.com"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonStyles.primary, "mt-5 w-full")}
      >
        Find a helpline in your country <ExternalLink className="size-5" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Dialog>
  );
});
