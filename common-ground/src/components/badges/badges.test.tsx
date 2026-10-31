// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Dynamic imports are slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function stubMatchMedia(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("the 13 badges", () => {
  it("every badge draws as decoration, with its word as real text beside it", async () => {
    stubMatchMedia(false);
    const { BADGE_IDS, badgeWord } = await import("./badge-medal");
    const { TitleBadge } = await import("@/components/title-badge");
    expect(BADGE_IDS).toHaveLength(13);
    const words = BADGE_IDS.map(badgeWord);
    expect(words).toEqual([
      "Glory",
      "Rookie",
      "Regular",
      "Veteran",
      "Elite",
      "Legend",
      "Final Boss",
      "Guildmaster",
      "Shogun",
      "Party Leader",
      "Squad Captain",
      "Crew Leader",
      "Host",
    ]);
    const { container } = render(
      <div>
        {BADGE_IDS.map((id) => (
          <TitleBadge key={id} id={id} />
        ))}
      </div>,
    );
    const svgs = container.querySelectorAll("svg[data-badge]");
    expect(svgs).toHaveLength(13);
    svgs.forEach((s) => expect(s.getAttribute("aria-hidden")).toBe("true"));
    // The word is never inside the art.
    svgs.forEach((s) => expect(s.querySelector("text")).toBeNull());
    for (const w of words) expect(screen.getByText(w)).toBeTruthy();
  });

  it("rings use category colours by family, and an unearned badge is an outline", async () => {
    stubMatchMedia(false);
    const { BADGE_RING, BadgeMedal, badgeFamily } = await import("./badge-medal");
    expect(badgeFamily("glory")).toBe("glory");
    expect(badgeFamily("veteran")).toBe("stage");
    expect(badgeFamily("shogun")).toBe("public");
    expect(badgeFamily("host")).toBe("friends");
    for (const v of Object.values(BADGE_RING)) expect(v).toMatch(/^var\(--cat-/);
    const { container } = render(<BadgeMedal id="elite" earned={false} />);
    expect(container.querySelector("svg")?.getAttribute("data-earned")).toBe("no");
  });

  it("the Glory sun animates once, and is still under reduced motion", async () => {
    stubMatchMedia(false);
    const moving = await import("./badge-medal");
    const a = render(<moving.BadgeMedal id="glory" animate />);
    expect(a.container.querySelectorAll("animateTransform").length).toBeGreaterThan(0);
    cleanup();
    vi.resetModules();
    stubMatchMedia(true);
    const still = await import("./badge-medal");
    const b = render(<still.BadgeMedal id="glory" animate />);
    expect(b.container.querySelectorAll("animateTransform")).toHaveLength(0);
  });

  it("a badge with info opens its meaning in a sheet, for tap-only users", async () => {
    stubMatchMedia(false);
    // jsdom has no showModal.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    const { TitleBadge } = await import("@/components/title-badge");
    render(<TitleBadge id="final-boss" detail="at 2 places" info />);
    fireEvent.click(screen.getByRole("button", { name: /Final Boss.*at 2 places.*What does this mean/ }));
    expect(screen.getByText("Most visits here of anyone on Larry.")).toBeTruthy();
  });

  it("earnedBadges: a stage at any place earns every stage below it", async () => {
    stubMatchMedia(false);
    const { earnedBadges } = await import("./badge-shelf");
    const e = earnedBadges({ glory: 10, stages: ["veteran", null], publicTitles: ["shogun"], friendTitles: [] });
    expect([...e].sort()).toEqual(["glory", "regular", "rookie", "shogun", "veteran"].sort());
    expect(earnedBadges({ glory: 0, stages: [], publicTitles: [], friendTitles: [] }).size).toBe(0);
  });
});

describe("the venue podium and the Glory moment", () => {
  it("shows made-up names with the place, marks this phone's own row, and never links or shows visit numbers", async () => {
    stubMatchMedia(false);
    const { VenuePodium } = await import("@/components/venue-podium");
    const { container } = render(
      <VenuePodium
        placeName="Café Condi"
        open
        myAlias="BraveHeron9"
        onReroll={async () => true}
        entries={[
          { rank: 2, title: "guildmaster", alias: "QuietOtter42" },
          { rank: 1, title: "final-boss", alias: "BraveHeron9" },
          { rank: 3, title: "shogun", alias: "MossyLantern7" },
        ]}
      />,
    );
    const rows = container.querySelectorAll("[data-podium-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Final Boss");
    expect(rows[0].textContent).toContain("You");
    expect(container.textContent).toContain("at Café Condi");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s*visits?/);
    expect(container.textContent).not.toMatch(/u\//);
    expect(screen.getByRole("button", { name: /New name at this place/ })).toBeTruthy();
  });

  it("stays closed below the minimum, with a warm line", async () => {
    stubMatchMedia(false);
    const { VenuePodium } = await import("@/components/venue-podium");
    const { container } = render(<VenuePodium placeName="Café Condi" open={false} entries={[]} />);
    expect(container.querySelector("[data-podium-closed]")?.textContent).toContain("opens once a few more regulars count here");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the Glory moment ties the gain to one real visit and shows a fresh stage", async () => {
    stubMatchMedia(true);
    const { GloryMoment } = await import("@/components/glory-moment");
    const { container } = render(<GloryMoment total={45} gain={15} placeName="Dice and Tea" stageEarned="regular" />);
    expect(container.textContent).toContain("+15 Glory for your visit to Dice and Tea.");
    expect(container.textContent).toContain("Regular");
    expect(container.querySelector('[data-stamp][data-fresh="true"]')).toBeTruthy();
    // Reduced motion: the sun is still.
    expect(container.querySelectorAll("animateTransform")).toHaveLength(0);
  });
});
