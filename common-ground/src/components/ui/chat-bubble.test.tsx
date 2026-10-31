// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Award, Check } from "lucide-react";
import { ChatBubble } from "./chat-bubble";
import { Stamp } from "./stamp";

afterEach(cleanup);

describe("ChatBubble", () => {
  it("labels Larry as an AI, with the mascot, on an ink bubble", () => {
    render(<ChatBubble sender="larry">Hi both. What are you into?</ChatBubble>);
    expect(screen.getByText(/Larry \(AI pal\)/)).toBeTruthy();
    expect(screen.getByAltText("Larry, an AI pal")).toBeTruthy();
    const bubble = screen.getByText("Hi both. What are you into?");
    expect(bubble.className).toContain("bg-ink");
    expect(bubble.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("larry");
  });

  it("quiet Larry is a tone change, never a fade", () => {
    render(
      <ChatBubble sender="larry" quiet>
        You two seem fine without me.
      </ChatBubble>,
    );
    const bubble = screen.getByText("You two seem fine without me.");
    expect(bubble.className).toContain("bg-paper");
    expect(bubble.className).toContain("text-ink-soft");
    expect(document.body.innerHTML).not.toMatch(/opacity/);
  });

  it("keeps the person's own initial on the tile when the name line says You", () => {
    const { container } = render(
      <ChatBubble sender="person" name="You" initial="Sam" seatColor="var(--seat-1)" align="end" avatar="hide-on-phone">
        On my way
      </ChatBubble>,
    );
    expect(screen.getByText("You")).toBeTruthy();
    const tile = container.querySelector("span[aria-hidden]")!;
    expect(tile.textContent).toBe("S");
    expect(tile.className).toContain("max-sm:hidden");
  });

  it("a person's bubble rings in their seat colour, never colours their name", () => {
    render(
      <ChatBubble sender="person" name="Priya" seatColor="var(--seat-2)" align="end">
        Spirited Away!
      </ChatBubble>,
    );
    const bubble = screen.getByText("Spirited Away!");
    expect(bubble.style.getPropertyValue("--tw-ring-color")).toBe("var(--seat-2)");
    const name = screen.getByText("Priya");
    expect(name.getAttribute("style")).toBeNull();
    expect(name.className).toContain("text-ink-soft");
    expect(bubble.closest("[data-bubble]")?.className).toContain("flex-row-reverse");
  });

  it("says in words when Larry never saw a line, when a line was to Larry, and when a person is made up", () => {
    render(
      <>
        <ChatBubble sender="person" name="Sam" excused>
          Just us now
        </ChatBubble>
        <ChatBubble sender="person" name="Asha" toLarry>
          Any films?
        </ChatBubble>
        <ChatBubble sender="person" name="Kai" practice>
          Hey!
        </ChatBubble>
      </>,
    );
    expect(screen.getByText("Sam, not seen by Larry")).toBeTruthy();
    expect(screen.getByText("Asha, to Larry")).toBeTruthy();
    expect(screen.getByText("Kai (practice pal)")).toBeTruthy();
  });

  it("later lines in a run keep the name for screen readers only", () => {
    render(
      <ChatBubble sender="person" name="Sam" showName={false}>
        And Minecraft
      </ChatBubble>,
    );
    expect(screen.getByText("Sam").className).toContain("sr-only");
  });

  it("with no seat colour the person's tile is ink on paper, never ink on ink", () => {
    render(
      <ChatBubble sender="person" name="sam">
        Hello
      </ChatBubble>,
    );
    const tile = document.querySelector("[data-bubble] > span[aria-hidden]") as HTMLElement;
    expect(tile.textContent).toBe("S");
    expect(tile.className).toContain("bg-paper");
    expect(tile.getAttribute("style")).toBeNull();
  });
});

describe("Stamp", () => {
  it("prints its word, hides its icon and reads its pips as words", () => {
    render(
      <Stamp icon={<Award data-testid="icon" />} pips={3} detail="at Café Condi">
        Elite
      </Stamp>,
    );
    expect(screen.getByText("Elite")).toBeTruthy();
    expect(screen.getByText("at Café Condi")).toBeTruthy();
    expect(screen.getByTestId("icon").closest("[aria-hidden]")).not.toBeNull();
    expect(screen.getByText("3 of 5").className).toContain("sr-only");
    const pips = document.querySelectorAll("[data-pip]");
    expect(pips).toHaveLength(5);
    expect(document.querySelectorAll('[data-pip="on"]')).toHaveLength(3);
  });

  it("clamps pips and accepts a better spoken label", () => {
    render(
      <Stamp pips={9} pipsMax={4} pipsLabel="4 of 4 visits">
        Regular
      </Stamp>,
    );
    expect(document.querySelectorAll('[data-pip="on"]')).toHaveLength(4);
    expect(screen.getByText("4 of 4 visits")).toBeTruthy();
  });

  it("strength is fill, never metal: outline and solid use ink and paper only", () => {
    render(
      <>
        <Stamp>Rookie</Stamp>
        <Stamp variant="solid">Legend</Stamp>
      </>,
    );
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/gold|silver|bronze|amber|yellow|cat-|tv|books/);
    expect(document.querySelector('[data-stamp="outline"]')?.className).toContain("bg-paper");
    expect(document.querySelector('[data-stamp="solid"]')?.className).toContain("bg-ink");
  });

  it("the Done stamp is the one uppercase, tilted, text-safe violet mark", () => {
    render(
      <Stamp variant="done" icon={<Check />}>
        Done 30 Oct
      </Stamp>,
    );
    const s = document.querySelector('[data-stamp="done"]')!;
    expect(s.className).toContain("uppercase");
    expect(s.className).toContain("text-cat-games-ink");
    expect(s.className).toContain("border-(length:--border-frame)");
  });
});
