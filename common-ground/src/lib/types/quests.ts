// Quests: a month-long real-world arc, completed only by verified check-ins. Never "failed" or
// "expired": an unfinished quest quietly leaves at the end of the month.

export type QuestKind = "return" | "explore" | "duo";

export interface Quest {
  id: string;
  /** Larry's grounded quest name, e.g. "The Quiet Café Crawl". */
  name: string;
  kind: QuestKind;
  /** Verified check-ins needed. */
  goal: number;
  /** Verified check-ins so far (0..goal). Never goes down. */
  progress: number;
  /** "YYYY-MM" */
  month: string;
  /** The plain goal line, e.g. "Try 3 calm places this month." */
  goalLine?: string;
}
