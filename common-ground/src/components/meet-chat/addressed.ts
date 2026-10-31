// Who Larry just asked, in a group of 2 to 5. The same rule as src/lib/addressed.ts (the pair
// session's two-seat version): the name opens the last question ("Priya, ...") or closes it
// ("..., Priya?"). Undefined when nobody, or more than one person, is asked.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function addressedMember<T extends { id: string; name: string }>(text: string, members: T[]): T | undefined {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const question = [...sentences].reverse().find((s) => s.includes("?"));
  if (!question) return undefined;
  const q = question.trim().replace(/[’‘]/g, "'");

  const opens = (name: string) =>
    new RegExp(`^(?:(?:and|so|ok|okay|now)[, ]+)?${escape(name)}\\b(?!'s|\\s+(?:and|&)\\s)`, "i").test(q);
  const closes = (name: string) => new RegExp(`[,—–-]\\s*${escape(name)}\\s*[?!.]*$`, "i").test(q);

  // Two people with the same name can't be told apart, so neither counts as asked.
  const names = members.map((m) => m.name.trim().toLowerCase());
  const hits = members.filter((m, i) => {
    const name = m.name.trim();
    if (!name || names.indexOf(names[i]) !== names.lastIndexOf(names[i])) return false;
    return opens(name) || closes(name);
  });
  return hits.length === 1 ? hits[0] : undefined;
}
