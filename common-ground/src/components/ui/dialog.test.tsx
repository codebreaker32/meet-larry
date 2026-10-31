// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LifeBuoy } from "lucide-react";
import { Dialog } from "./dialog";

// jsdom has no modal dialogs: a minimal stand-in that flips `open` and fires "close" like a browser.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(cleanup);

function Harness({ dismissible, onClosed }: { dismissible?: boolean; onClosed?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Need help now?
      </button>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Need help now?"
        icon={<LifeBuoy />}
        description="Larry is an AI. You matter."
        dismissible={dismissible}
        onClosed={onClosed}
      >
        <p>Call a free helpline.</p>
      </Dialog>
    </>
  );
}

const dialogEl = () => document.querySelector("dialog") as HTMLDialogElement;

describe("Dialog", () => {
  it("opens with showModal and is named by its title and described by its description", () => {
    render(<Harness />);
    expect(dialogEl().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    const d = dialogEl();
    expect(d.open).toBe(true);
    const title = d.querySelector("h2")!;
    expect(title.textContent).toBe("Need help now?");
    expect(d.getAttribute("aria-labelledby")).toBe(title.id);
    expect(document.getElementById(d.getAttribute("aria-describedby")!)?.textContent).toBe("Larry is an AI. You matter.");
  });

  it("the 48px Close button closes it and keeps the caller's state in step", () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-12");
    fireEvent.click(close);
    expect(dialogEl().open).toBe(false);
    expect(screen.getByTestId("state").textContent).toBe("closed");
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("Escape and a tap on the scrim close it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    fireEvent(dialogEl(), new Event("cancel", { cancelable: true }));
    expect(screen.getByTestId("state").textContent).toBe("closed");

    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    fireEvent.click(dialogEl());
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("a tap inside the panel does not close it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    fireEvent.click(screen.getByText("Call a free helpline."));
    expect(screen.getByTestId("state").textContent).toBe("open");
  });

  it("a step that must be answered has no Close button and ignores Escape and the scrim", () => {
    render(<Harness dismissible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialogEl(), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(dialogEl());
    expect(screen.getByTestId("state").textContent).toBe("open");
  });

  it("uses the scrim and the dialog width tokens", () => {
    render(<Dialog open={false} onOpenChange={() => {}} title="Block" size="sm" />);
    const cls = dialogEl().className;
    expect(cls).toContain("backdrop:bg-scrim");
    expect(cls).toContain("max-w-dialog-sm");
    expect(cls).not.toMatch(/ink\/\d+/);
  });

  it("initialFocus moves first focus to the safe choice", () => {
    function Leave() {
      const [open, setOpen] = React.useState(false);
      const stay = React.useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Back
          </button>
          <Dialog open={open} onOpenChange={setOpen} title="Leave this chat?" size="sm" initialFocus={stay}>
            <button ref={stay} type="button" onClick={() => setOpen(false)}>
              Stay
            </button>
          </Dialog>
        </>
      );
    }
    render(<Leave />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay" }));
  });
});
