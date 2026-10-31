// Who Larry just asked. Larry is told to end each reply with a question for exactly one person,
// by name ("Priya, have you seen it?"). The one-tap replies then answer as that person, so a
// tap-only user doesn't have to pick their name first.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The seat addressed by the last question in `text`: its name opens the question ("Priya, ...")
 * or closes it ("..., Priya?"). Undefined when no single seat is addressed, or the names match.
 */
export function addressedSeat(text: string, aName: string, bName: string): "a" | "b" | undefined {
  const a = aName.trim();
  const b = bName.trim();
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return undefined;
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const question = [...sentences].reverse().find((s) => s.includes("?"));
  if (!question) return undefined;
  const q = question.trim().replace(/[’‘]/g, "'");

  const opens = (name: string) => new RegExp(`^(?:(?:and|so|ok|okay|now)[, ]+)?${escape(name)}\\b(?!'s|\\s+(?:and|&)\\s)`, "i").test(q);
  const closes = (name: string) => new RegExp(`[,—–-]\\s*${escape(name)}\\s*[?!.]*$`, "i").test(q);
  const hitA = opens(a) || closes(a);
  const hitB = opens(b) || closes(b);
  if (hitA === hitB) return undefined;
  return hitA ? "a" : "b";
}
