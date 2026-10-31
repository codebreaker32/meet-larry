"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Check, Copy, Lock, ScanLine, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { QR_OPTIONS } from "@/lib/qr";
import { useOrigin } from "@/lib/storage";
import { cn } from "@/lib/utils";
import {
  DEMO_FRIEND_LABEL,
  type DemoFriendOption,
  GROUP_WORD_LOWER,
  type GroupJoinTicket,
  type GroupState,
  type GroupView,
  demoFriendOptions,
  demoFriendScan,
  groupJoinLink,
} from "./group-api";

/**
 * The live group QR, for the person who started the group. No countdown: one calm line says joining
 * closes in 15 minutes (the server stops the QR after 15 minutes, or once the group is full).
 * Shows who has joined so far, and "Close joining" for the creator.
 */
export function GroupQrPanel({
  group,
  join,
  onClose,
  closing = false,
  onApplied,
  className,
}: {
  group: GroupView;
  /** The QR ticket from creating the group (or a fresh QR). */
  join: GroupJoinTicket;
  onClose: () => void;
  closing?: boolean;
  /** A demo friend scanned it (demo account only): the fresh group. */
  onApplied?: (state: Partial<GroupState>) => void;
  className?: string;
}) {
  const origin = useOrigin();
  const link = origin ? groupJoinLink(origin, join.token) : "";
  const [qr, setQr] = React.useState<{ link: string; image: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { ...QR_OPTIONS, width: 640 })
      .then((image) => setQr({ link, image }))
      .catch(() => setQr(null));
  }, [link]);
  const image = qr?.link === link ? qr.image : null;

  const here = group.members.length;
  const spots = group.openSeats;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="qr-title" className={cn("flex flex-col items-center gap-4 rounded-panel border-2 border-ink bg-paper p-5 sm:p-6", className)}>
      <h2 id="qr-title" className="text-center font-display text-title-sm font-black leading-tight">
        {spots === 1 ? "Ask them to scan this" : `Ask ${spots} people to scan this`}
      </h2>
      <div className="foil relative w-full max-w-[18rem] rounded-card bg-ink p-4">
        <div className="rounded-mini bg-paper p-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL from the qrcode library
            <img src={image} alt={`QR code to join this ${GROUP_WORD_LOWER}`} className="aspect-square w-full" />
          ) : (
            <div className="aspect-square w-full" aria-hidden />
          )}
        </div>
      </div>
      <p className="max-w-measure text-center text-body text-ink-soft">
        They scan it with their phone camera and sign in. Joining closes in 15 minutes, or once you&apos;re all here.
      </p>
      <p className="flex items-center gap-2 font-bold text-ink" role="status">
        <Users className="size-5" aria-hidden />
        {here} of {group.size} here
      </p>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        {link && (
          <Button variant="secondary" onClick={copy} icon={copied ? <Check /> : <Copy />}>
            {copied ? "Link copied" : "Copy the link"}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} loading={closing} icon={<Lock />}>
          Close joining
        </Button>
      </div>
      <DemoFriendScan groupId={group.id} here={here} onApplied={onApplied} />
    </section>
  );
}

/**
 * "Let a demo friend scan it": only the demo account ever sees this. The server answers the list
 * only for the demo account that started this group while its QR is live; everyone else gets none,
 * so this renders nothing. Demo friends are made up and labelled; picking one joins them as if they
 * scanned the QR.
 */
function DemoFriendScan({ groupId, here, onApplied }: { groupId: string; here: number; onApplied?: (state: Partial<GroupState>) => void }) {
  const [friends, setFriends] = React.useState<DemoFriendOption[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctl = new AbortController();
    demoFriendOptions(groupId, ctl.signal)
      .then(setFriends)
      .catch(() => undefined);
    return () => ctl.abort();
  }, [groupId, here]);

  if (!friends.length) return null;

  const scan = async (f: DemoFriendOption) => {
    if (busy) return;
    setBusy(f.key);
    setError(null);
    try {
      const out = await demoFriendScan(groupId, f.key);
      setFriends((list) => list.filter((x) => x.key !== f.key));
      onApplied?.(out);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="group" className="flex w-full flex-col gap-3 border-t-2 border-line pt-4" aria-labelledby="demo-scan-title">
      <h3 id="demo-scan-title" className="flex items-center gap-2 font-display text-body font-black">
        <ScanLine className="size-5" aria-hidden />
        Let a demo friend scan it
      </h3>
      <p className="text-label text-ink-soft">
        Only the demo account sees this. Demo friends are made up, not real people, so you can try a {GROUP_WORD_LOWER} with one phone.
      </p>
      <ul className="flex flex-col gap-2">
        {friends.map((f) => (
          <li key={f.key}>
            <Button
              variant="secondary"
              className="w-full justify-start text-left"
              loading={busy === f.key}
              onClick={() => void scan(f)}
            >
              <span className="flex min-w-0 flex-col py-1">
                <span>
                  {f.name} <span className="font-normal text-ink-soft">({DEMO_FRIEND_LABEL})</span>
                </span>
                <span className="truncate text-label font-normal text-ink-soft">{f.vibe}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-label font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
