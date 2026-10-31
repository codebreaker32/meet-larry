import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// tailwind-merge must know the theme's own steps, or it reads `text-title-page` as a colour and
// drops it next to `text-ink` (found at gate G1).
describe("cn knows the theme tokens", () => {
  it("keeps a type size next to a text colour", () => {
    expect(cn("text-title-page", "text-ink")).toBe("text-title-page text-ink");
    expect(cn("text-display", "text-text-primary")).toBe("text-display text-text-primary");
    expect(cn("text-title-session", "text-ink-soft")).toBe("text-title-session text-ink-soft");
  });
  it("lets a later size, radius, shadow or easing win", () => { // taste-skill-ignore: tests the shadow token merge, not a style
    expect(cn("text-title-page", "text-body")).toBe("text-body");
    expect(cn("rounded-badge", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-inner", "rounded-tile")).toBe("rounded-tile");
    expect(cn("shadow-lift", "shadow-none")).toBe("shadow-none");
    expect(cn("ease-deal", "ease-out")).toBe("ease-out");
  });
  it("keeps a border colour next to a border width", () => {
    expect(cn("border-border-subtle", "border-2")).toBe("border-border-subtle border-2");
  });
});
