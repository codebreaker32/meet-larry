import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_STYLE, SPORT_FILTERS } from "./domain-style";
import { readdirSync, statSync } from "node:fs";
import { DURATION, EASE_DEAL, PALETTE, QR_COLORS, SEAT_COLORS, THEME_COLOR, normalizeSeatColor, seatColorAt } from "./tokens";
import { DOMAIN_KEYS } from "./types";

// Comments are dropped first, so a note such as "not --cat-games: ..." is never read as a definition.
const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every custom property defined in globals.css, with its raw value (first definition wins). */
const defined = new Map<string, string>();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  if (!defined.has(m[1])) defined.set(m[1], m[2].trim());
}

/** Follows var(--x) aliases down to a literal value. */
function resolve(name: string, seen = new Set<string>()): string {
  const value = defined.get(name);
  if (value === undefined) throw new Error(`${name} is not defined in globals.css`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  if (!alias) return value;
  if (seen.has(name)) throw new Error(`${name} is a circular alias`);
  seen.add(name);
  return resolve(alias[1], seen);
}

/** WCAG contrast ratio between two tokens that resolve to hex colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(resolve(a)), luminance(resolve(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const varName = (cssVar: string) => cssVar.match(/^var\((--[\w-]+)\)$/)?.[1];

describe("DOMAIN_STYLE: category = colour + icon, always", () => {
  const entries = DOMAIN_KEYS.map((d) => [d, DOMAIN_STYLE[d]] as const);

  it("covers every Qloo domain", () => {
    expect(Object.keys(DOMAIN_STYLE).sort()).toEqual([...DOMAIN_KEYS].sort());
  });

  it("gives every category its own icon, so colour is never the only cue", () => {
    const icons = entries.map(([, s]) => s.Icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("gives every category its own label and its own colour", () => {
    expect(new Set(entries.map(([, s]) => s.label)).size).toBe(entries.length);
    expect(new Set(entries.map(([, s]) => s.color)).size).toBe(entries.length);
  });

  it("reads colours only from the --cat-* tokens, and each one is defined", () => {
    for (const [, s] of entries) {
      const name = varName(s.color);
      expect(name, s.label).toMatch(/^--cat-[a-z]+$/);
      expect(resolve(name!), s.label).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("gives every sport filter its own icon, distinct from the category icons", () => {
    const sportIcons = SPORT_FILTERS.map((f) => f.Icon);
    expect(new Set(sportIcons).size).toBe(sportIcons.length);
    const categoryIcons = new Set(entries.map(([, s]) => s.Icon));
    for (const f of SPORT_FILTERS) expect(categoryIcons.has(f.Icon), f.label).toBe(false);
  });
});

describe("globals.css token layers", () => {
  it("defines every variable it reads (except ones set at runtime or by Tailwind and next/font)", () => {
    // angle/mx/my: the foil follows the pointer; deal-*: each dealt card sets its own start (deal-in.tsx).
    const runtime = /^--(tw-|font-atkinson|font-anybody|angle|mx|my|deal-)/;
    const missing = [...css.matchAll(/var\((--[\w-]+)/g)]
      .map((m) => m[1])
      .filter((n) => !runtime.test(n) && !defined.has(n));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps the old category names as aliases of --cat-*", () => {
    const aliases: Record<string, string> = {
      "--film": "--cat-film",
      "--tv": "--cat-tv",
      "--music": "--cat-music",
      "--games": "--cat-games",
      "--books": "--cat-books",
      "--sports": "--cat-sports",
      "--players": "--cat-players",
      "--podcast": "--cat-podcasts",
      "--brand": "--cat-brands",
      "--travel": "--cat-travel",
      "--people": "--cat-people",
      "--games-ink": "--cat-games-ink",
      "--games-tint": "--cat-games-tint",
    };
    for (const [old, next] of Object.entries(aliases)) expect(defined.get(old), old).toBe(`var(${next})`);
  });

  it("gives control edges at least 3:1 on paper and table (WCAG 1.4.11)", () => {
    for (const ground of ["--paper", "--table"]) {
      expect(contrast("--border-control", ground), ground).toBeGreaterThanOrEqual(3);
    }
  });

  it("shows the focus ring at 3:1 or more on every surface, in a colour no category frame uses", () => {
    for (const ground of ["--paper", "--table"]) expect(contrast("--focus-ring", ground), ground).toBeGreaterThanOrEqual(3);
    for (const ground of ["--ink", "--mat"]) expect(contrast("--focus-ring-inverse", ground), ground).toBeGreaterThanOrEqual(3);
    const frames = DOMAIN_KEYS.map((d) => resolve(varName(DOMAIN_STYLE[d].color)!));
    expect(frames).not.toContain(resolve("--focus-ring"));
  });

  it("keeps danger text at AA on paper and table", () => {
    for (const ground of ["--paper", "--table"]) expect(contrast("--text-danger", ground), ground).toBeGreaterThanOrEqual(4.5);
  });

  it("defines the deal easing exactly once", () => {
    expect(css.match(/0\.16,\s*1,\s*0\.3,\s*1/g)).toHaveLength(1);
    expect(defined.get("--ease-deal")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("uses no alpha-modified ink borders", () => {
    expect(css).not.toMatch(/border-ink\/\d+/);
  });
});

describe("tokens.ts mirrors globals.css", () => {
  it("has the same neutral hex values", () => {
    expect(PALETTE.table).toBe(resolve("--table"));
    expect(PALETTE.ink).toBe(resolve("--ink"));
    expect(PALETTE.paper).toBe(resolve("--paper"));
    expect(THEME_COLOR).toBe(resolve("--surface-page"));
    expect(QR_COLORS).toEqual({ dark: resolve("--ink"), light: resolve("--paper") });
  });

  it("lists five distinct seats, each a defined token on a category frame", () => {
    expect(SEAT_COLORS).toHaveLength(5);
    const hexes = SEAT_COLORS.map((c) => {
      const name = varName(c);
      expect(name).toMatch(/^--seat-[1-5]$/);
      return resolve(name!);
    });
    expect(new Set(hexes).size).toBe(5);
    const frames = new Set(DOMAIN_KEYS.map((d) => resolve(varName(DOMAIN_STYLE[d].color)!)));
    for (const h of hexes) expect(frames.has(h)).toBe(true);
  });

  it("wraps seat indexes", () => {
    expect(seatColorAt(0)).toBe("var(--seat-1)");
    expect(seatColorAt(4)).toBe("var(--seat-5)");
    expect(seatColorAt(5)).toBe("var(--seat-1)");
    expect(seatColorAt(-1)).toBe("var(--seat-5)");
    expect(seatColorAt(Number.NaN)).toBe("var(--seat-1)");
  });

  it("maps seat colours saved before the tokens to their seat, and passes others through", () => {
    expect(["var(--film)", "var(--music)", "var(--games)", "var(--books)", "var(--tv)"].map(normalizeSeatColor)).toEqual([...SEAT_COLORS]);
    expect(normalizeSeatColor("var(--seat-3)")).toBe("var(--seat-3)");
    expect(normalizeSeatColor("#ff0000")).toBe("#ff0000");
  });

  it("is the only seat list: no other source file hand-writes an ordered list of seat colours", () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(root);
    // An array literal opening with two seat or old-style category colours, e.g. ["var(--film)", "var(--music)", ...].
    // (Decorative --cat-* lists, such as the landing's Pick. Find. Go out. words, are not seats.)
    const seat = String.raw`"var\(--(?:seat-\d|film|tv|music|games|books|players)\)"`;
    const seatArray = new RegExp(String.raw`\[\s*${seat}\s*,\s*${seat}`);
    const offenders = files.filter((f) => !f.endsWith(path.join("lib", "tokens.ts")) && seatArray.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("has the same deal curve and durations", () => {
    expect(defined.get("--ease-deal")).toBe(`cubic-bezier(${EASE_DEAL.join(", ")})`);
    expect(defined.get("--dur-quick")).toBe(`${DURATION.quick * 1000}ms`);
    expect(defined.get("--dur-base")).toBe(`${DURATION.base * 1000}ms`);
    expect(defined.get("--dur-deal")).toBe(`${DURATION.deal * 1000}ms`);
  });
});
