// One command list for every place Larry can be tagged: the @Larry menu in group chats (2C renders
// LARRY_COMMANDS) and the server that answers it. Both read this file, so they never drift.
// Pure and framework-free: safe to import on the server and in the client bundle.

/** Every command Larry answers when tagged. Order = menu order. */
export const LARRY_COMMAND_IDS = [
  "plan",
  "together",
  "gems",
  "twin",
  "rising",
  "matchday",
  "mood",
  "excuse",
  "hello",
  "help",
] as const;

export type LarryCommandId = (typeof LARRY_COMMAND_IDS)[number];

/**
 * Lucide icon names (PascalCase, as exported by lucide-react). The menu maps the name to the
 * component itself, so this file stays free of React.
 */
export type LarryCommandIcon =
  | "Ticket"
  | "Handshake"
  | "Gem"
  | "Users"
  | "TrendingUp"
  | "Tv"
  | "Smile"
  | "DoorOpen"
  | "Hand"
  | "CircleHelp";

export interface LarryCommand {
  /** The slash command without the slash, e.g. "plan". */
  cmd: LarryCommandId;
  /** Short menu label, easy-read. */
  label: string;
  /** One line under the label: what Larry does. */
  hint: string;
  icon: LarryCommandIcon;
  /** True when the command only makes sense with 2+ people (groups). */
  groupOnly?: boolean;
}

export const LARRY_COMMANDS: readonly LarryCommand[] = [
  { cmd: "plan", label: "Plan", hint: "A Plan Ticket for all of you", icon: "Ticket" },
  { cmd: "together", label: "Common ground", hint: "What you all like, and why", icon: "Handshake", groupOnly: true },
  { cmd: "gems", label: "Gems", hint: "Loved by your kind of people, less known", icon: "Gem" },
  { cmd: "twin", label: "Twin", hint: "Your taste twin in another world", icon: "Users" },
  { cmd: "rising", label: "Rising", hint: "Is anything you like climbing?", icon: "TrendingUp" },
  { cmd: "matchday", label: "Match Day", hint: "Watch a game together, somewhere calm", icon: "Tv" },
  { cmd: "mood", label: "Mood", hint: "Tell Larry how you feel today", icon: "Smile" },
  { cmd: "excuse", label: "Excuse", hint: "Larry steps out until you say hello", icon: "DoorOpen" },
  { cmd: "hello", label: "Hello", hint: "Bring Larry back in", icon: "Hand" },
  { cmd: "help", label: "Help", hint: "What Larry can do here", icon: "CircleHelp" },
];

const BY_ID = new Map<LarryCommandId, LarryCommand>(LARRY_COMMANDS.map((c) => [c.cmd, c]));

/** Words people type that mean a command ("@Larry plan something", "/match_day"). */
const ALIASES: Record<string, LarryCommandId> = {
  plan: "plan",
  ticket: "plan",
  together: "together",
  common: "together",
  commonground: "together",
  ground: "together",
  gems: "gems",
  gem: "gems",
  hidden: "gems",
  hiddengems: "gems",
  twin: "twin",
  tastetwin: "twin",
  rising: "rising",
  trending: "rising",
  big: "rising",
  matchday: "matchday",
  match: "matchday",
  game: "matchday",
  mood: "mood",
  excuse: "excuse",
  hello: "hello",
  hi: "hello",
  help: "help",
};

export function larryCommand(id: LarryCommandId): LarryCommand {
  return BY_ID.get(id)!;
}

export function isLarryCommandId(value: string): value is LarryCommandId {
  return BY_ID.has(value as LarryCommandId);
}

export type ParsedLarryCommand =
  /** A known command, by slash or by the first word after @Larry. `args` is the rest, trimmed. */
  | { kind: "command"; cmd: LarryCommandId; args: string; via: "slash" | "mention" }
  /** "@Larry <free text>": Larry was tagged with a question, not a command. */
  | { kind: "ask"; text: string }
  /** Not addressed to Larry: Larry stays quiet. */
  | { kind: "none" };

/** "/plan", "/match_day saturday". Case-insensitive. */
const SLASH_RE = /^\/([a-z_]+)(?:\s+([\s\S]*))?$/i;
/** "@Larry", "@larry,", "@Larry:" at the start. */
const MENTION_RE = /^@larry\b[\s,:;.!-]*([\s\S]*)$/i;

function normalise(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Reads one message. Larry answers only when tagged, so anything that does not start with
 * "@Larry" or a known "/command" is { kind: "none" }. An unknown slash word is "none" too.
 */
export function parseLarryCommand(text: string): ParsedLarryCommand {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { kind: "none" };

  const slash = SLASH_RE.exec(trimmed);
  if (slash) {
    const id = ALIASES[normalise(slash[1])];
    if (!id) return { kind: "none" };
    return { kind: "command", cmd: id, args: (slash[2] ?? "").trim(), via: "slash" };
  }

  const mention = MENTION_RE.exec(trimmed);
  if (!mention) return { kind: "none" };
  const rest = mention[1].trim();
  if (!rest) return { kind: "command", cmd: "help", args: "", via: "mention" };

  // "@Larry /plan" or "@Larry plan for saturday" or "@Larry match day?"
  const inner = rest.startsWith("/") ? SLASH_RE.exec(rest) : null;
  if (inner) {
    const id = ALIASES[normalise(inner[1])];
    if (id) return { kind: "command", cmd: id, args: (inner[2] ?? "").trim(), via: "mention" };
    return { kind: "ask", text: rest };
  }
  const words = rest.split(/\s+/);
  const two = normalise(words.slice(0, 2).join(""));
  if (words.length >= 2 && ALIASES[two] && (two === "matchday" || two === "commonground" || two === "hiddengems" || two === "tastetwin")) {
    return { kind: "command", cmd: ALIASES[two], args: words.slice(2).join(" ").trim(), via: "mention" };
  }
  const first = normalise(words[0]);
  // Only the exact command words count after @Larry; "@Larry big day today" is a question.
  if (isLarryCommandId(first)) {
    return { kind: "command", cmd: first, args: words.slice(1).join(" ").trim(), via: "mention" };
  }
  return { kind: "ask", text: rest };
}

/** What the menu sends when a command is picked: the slash form, so typed and picked commands read the same. */
export function commandText(id: LarryCommandId, args = ""): string {
  return args.trim() ? `/${id} ${args.trim()}` : `/${id}`;
}

/** Menu filter for typed "@pl" or "/ma": matches the command, label or alias prefix. */
export function filterLarryCommands(query: string, opts: { group?: boolean } = {}): LarryCommand[] {
  const q = normalise(query.replace(/^[@/]\s*(larry\s*)?/i, ""));
  const list = LARRY_COMMANDS.filter((c) => opts.group !== false || !c.groupOnly);
  if (!q) return [...list];
  return list.filter(
    (c) =>
      c.cmd.startsWith(q) ||
      normalise(c.label).startsWith(q) ||
      Object.entries(ALIASES).some(([alias, id]) => id === c.cmd && alias.startsWith(q)),
  );
}
