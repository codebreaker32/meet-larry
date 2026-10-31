import { CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The top of a profile: an ink card face with the public username in Anybody. The username is shown
 * as it is (QuietOtter42), never with a "u/" prefix. Friends and the owner also see the name.
 */
export function ProfileHeader({
  username,
  displayName,
  note,
  as: Heading = "h1",
  className,
}: {
  username: string;
  displayName?: string;
  /** One quiet line under the name ("That's the only name other people see."). */
  note?: React.ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <header
      data-surface="inverse"
      className={cn("flex items-center gap-4 rounded-card bg-ink p-4 text-paper shadow-card sm:p-5", className)}
    >
      <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-paper text-ink">
        <CircleUserRound className="size-7" />
      </span>
      <div className="min-w-0">
        <Heading className="break-words font-display text-title-sm font-black leading-title sm:text-title-md" data-username>
          {username}
        </Heading>
        {displayName && <p className="text-lead font-bold text-paper-soft">{displayName}</p>}
        {note && <p className="mt-1 text-label text-paper-soft">{note}</p>}
      </div>
    </header>
  );
}
