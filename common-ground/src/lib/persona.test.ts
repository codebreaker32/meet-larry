import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Persona, PersonaUpdate } from "./contracts";
import {
  applyPersonaUpdate,
  describePersonaUpdate,
  emptyPersona,
  isEmptyUpdate,
  loadPersona,
  NOTES_MAX,
  parsePersona,
  personaFromProfile,
  personaToProfile,
  savePersona,
  undoPersonaUpdate,
} from "./persona";
import type { TasteItem } from "./types";

const item = (n: number, domain: TasteItem["domain"] = "movie"): TasteItem => ({ id: `id-${n}`, name: `Pick ${n}`, domain });
const noUpdate: PersonaUpdate = { addLikes: [], addDislikes: [], addNotes: [] };

function persona(likes: TasteItem[], extra: Partial<Persona> = {}): Persona {
  return { ...emptyPersona("Sam"), likes, ...extra };
}

describe("persona", () => {
  it("migrates an old card and gives back the top picks", () => {
    const p = personaFromProfile({ name: "Sam", items: [item(1), item(2), item(3)] });
    expect(p).toMatchObject({ version: 1, name: "Sam", dislikes: [], notes: [] });
    expect(personaToProfile(p, 2)).toEqual({ name: "Sam", items: [item(1), item(2)] });
    expect(personaToProfile(persona(Array.from({ length: 30 }, (_, i) => item(i)))).items).toHaveLength(10);
  });

  it("puts new and confirmed likes first, without repeats", () => {
    const p = persona([item(1), item(2), item(3)]);
    const next = applyPersonaUpdate(p, { ...noUpdate, addLikes: [item(9), item(3)] });
    expect(next.likes.map((l) => l.id)).toEqual(["id-9", "id-3", "id-1", "id-2"]);
  });

  it("has no pick limit for likes", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(i));
    expect(applyPersonaUpdate(persona([]), { ...noUpdate, addLikes: many }).likes).toHaveLength(60);
  });

  it("moves a thing between likes and dislikes", () => {
    const p = persona([item(1), item(2)]);
    const disliked = applyPersonaUpdate(p, { ...noUpdate, addDislikes: [{ name: "pick 2" }] });
    expect(disliked.likes.map((l) => l.id)).toEqual(["id-1"]);
    expect(disliked.dislikes).toEqual([{ name: "pick 2" }]);
    const liked = applyPersonaUpdate(disliked, { ...noUpdate, addLikes: [item(2)] });
    expect(liked.dislikes).toEqual([]);
  });

  it("keeps notes newest first, unique and capped", () => {
    let p = persona([]);
    for (let i = 0; i < NOTES_MAX + 5; i++) p = applyPersonaUpdate(p, { ...noUpdate, addNotes: [`note ${i}`] });
    p = applyPersonaUpdate(p, { ...noUpdate, addNotes: ["NOTE 24"], placeVibe: "calm" });
    expect(p.notes).toHaveLength(NOTES_MAX);
    expect(p.notes[0]).toBe("NOTE 24");
    expect(p.notes.filter((n) => n.toLowerCase() === "note 24")).toHaveLength(1);
    expect(p.placeVibe).toBe("calm");
  });

  it("cleans what arrives in an update", () => {
    const p = applyPersonaUpdate(persona([]), {
      addLikes: [{ id: "x", name: "<b>Bad</b>\nname", domain: "movie" }, { id: "y", name: "z", domain: "nope" as TasteItem["domain"] }],
      addDislikes: [{ name: "" }],
      addNotes: ["a".repeat(500)],
    });
    expect(p.likes).toEqual([{ id: "x", name: "bBad/b name", domain: "movie" }]);
    expect(p.dislikes).toEqual([]);
    expect(p.notes[0].length).toBeLessThanOrEqual(100);
  });

  it("undoes one update and keeps what came after", () => {
    const before = persona([item(1), item(2)], { notes: ["old"], dislikes: [{ name: "Pick 5" }] });
    const u: PersonaUpdate = { addLikes: [item(3), item(5)], addDislikes: [{ name: "Pick 2" }], addNotes: ["likes rain"], placeVibe: "cosy" };
    const after = applyPersonaUpdate(before, u);
    const later = applyPersonaUpdate(after, { ...noUpdate, addLikes: [item(7)] });
    const undone = undoPersonaUpdate(later, u, before);
    expect(undone.likes.map((l) => l.id)).toEqual(["id-7", "id-1", "id-2"]);
    expect(undone.dislikes).toEqual([{ name: "Pick 5" }]);
    expect(undone.notes).toEqual(["old"]);
    expect(undone.placeVibe).toBeUndefined();
  });

  it("describes an update in easy-read sentences", () => {
    expect(
      describePersonaUpdate({ addLikes: [item(1), item(2)], addDislikes: [{ name: "horror films" }], addNotes: ["plays cricket on Sundays"], placeVibe: "calm" }),
    ).toEqual(["You like Pick 1 and Pick 2.", "You don't enjoy horror films.", "You like calm, quiet places.", "Plays cricket on Sundays."]);
    expect(isEmptyUpdate(noUpdate)).toBe(true);
    expect(isEmptyUpdate({ ...noUpdate, placeVibe: "lively" })).toBe(false);
  });

  it("rejects things that are not a persona", () => {
    expect(parsePersona(null)).toBeNull();
    expect(parsePersona({ version: 2, likes: [] })).toBeNull();
    expect(parsePersona({ version: 1, name: "A", likes: [item(1), item(1)], placeVibe: "loud" })).toMatchObject({ likes: [item(1)] });
  });
});

describe("persona storage", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Object.assign(globalThis, { window: globalThis, localStorage: ls });
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("migrates the old saved card on first load", () => {
    store.set("cg.profile", JSON.stringify({ name: "Ana", items: [item(1)] }));
    expect(loadPersona()).toMatchObject({ name: "Ana", likes: [item(1)] });
    expect(JSON.parse(store.get("larry.persona") ?? "null")).toMatchObject({ version: 1, name: "Ana" });
  });

  it("saves on the device and mirrors the top picks for older screens", () => {
    savePersona(persona(Array.from({ length: 14 }, (_, i) => item(i))));
    expect(loadPersona()?.likes).toHaveLength(14);
    expect(JSON.parse(store.get("cg.profile") ?? "null").items).toHaveLength(10);
  });
});
