// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PromptInputBox } from "./ai-prompt-box";

afterEach(cleanup);

// Group chats (D25/D26): one @Larry button opens Larry's command menu as a listbox; typing "@" or "/"
// opens it too. No row of command chips, no reply suggestions. Plain words go to the people only.
function Box({ onSend }: { onSend: (text: string, toLarry: boolean) => void }) {
  return (
    <PromptInputBox
      speakers={[{ name: "Priya", color: "var(--ink)" }]}
      activeSpeaker={0}
      onSpeakerChange={() => {}}
      onSend={onSend}
      larryMenu={{ group: true }}
    />
  );
}

describe("PromptInputBox larryMenu", () => {
  it("has the @Larry button and no command chips until it is tapped", () => {
    render(<Box onSend={() => {}} />);
    const at = screen.getByRole("button", { name: "@Larry" });
    expect(at.getAttribute("aria-haspopup")).toBe("listbox");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    fireEvent.click(at);
    const menu = screen.getByRole("listbox", { name: "Ask Larry" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Plan"), expect.stringContaining("Common ground"), expect.stringContaining("Match Day")]),
    );
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(at);
  });

  it("typing / filters the menu, and Enter sends the command to Larry", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole("combobox", { name: /Message from Priya/ });
    fireEvent.change(box, { target: { value: "/pl" } });
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("/plan", true);
  });

  it("plain words go to the people, not Larry", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole("combobox", { name: /Message from Priya/ });
    fireEvent.change(box, { target: { value: "Board games on Saturday?" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("Board games on Saturday?", false);
  });

  it("tapping @Larry tags the message; tapping into the box closes the menu but keeps the tag", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "@Larry" }));
    const menu = screen.getByRole("listbox", { name: "Ask Larry" });
    const box = screen.getByRole("combobox", { name: /Message from Priya to Larry/ });
    fireEvent.blur(menu, { relatedTarget: box });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove the @Larry tag" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "where should we go?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("@Larry where should we go?", true);
    // Sent: the tag comes off.
    expect(screen.queryByRole("button", { name: "Remove the @Larry tag" })).toBeNull();
  });

  it("Escape keeps the tag; the x removes it, so plain words go to the people", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "@Larry" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove the @Larry tag" }));
    const box = screen.getByRole("combobox", { name: /Message from Priya$/ });
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi", false);
  });

  it("picking a command from the @Larry menu sends that command", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "@Larry" }));
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(onSend).toHaveBeenCalledWith("/plan", true);
  });
});
