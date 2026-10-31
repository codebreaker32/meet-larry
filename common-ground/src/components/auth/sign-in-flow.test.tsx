// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Regression: after the code is confirmed, the auth provider can report "signed-in" before the
// flow's own account check returns. The flow must not redirect then: the one location ask (D24)
// comes first on a phone that never answered it.

const replace = vi.fn();
const auth = { status: "signed-out" as string };
let setStatus: ((s: string) => void) | null = null;
let releaseFetch: (() => void) | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=/me"),
}));

vi.mock("./auth-provider", async () => {
  const React = await import("react");
  return {
    useAuth: () => {
      const [status, set] = React.useState(auth.status);
      setStatus = (s: string) => {
        auth.status = s;
        set(s);
      };
      return { status };
    },
  };
});

vi.mock("@/lib/firebase/client", () => ({
  PhoneSignInError: class extends Error {
    reason = "unavailable";
  },
  signInAvailable: () => true,
  toE164: (p: string) => (p ? `+91${p.replace(/\D/g, "")}` : null),
  sendSignInCode: async () => ({
    // The provider hears the sign-in at once, before the flow's own GET /api/account answers.
    confirm: async () => {
      act(() => setStatus?.("signed-in"));
    },
  }),
  authFetch: () => new Promise<Response>((ok) => (releaseFetch = () => ok(new Response("{}", { status: 200 })))),
}));

import { SignInFlow } from "./sign-in-flow";

beforeEach(() => {
  localStorage.clear();
  replace.mockClear();
  auth.status = "signed-out";
});
afterEach(cleanup);

describe("SignInFlow", () => {
  it("shows the one location ask even when the auth provider reports signed-in first", async () => {
    render(<SignInFlow />);
    fireEvent.change(screen.getByLabelText("Your phone number"), { target: { value: "9876543210" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Text me a code" }));
    });
    fireEvent.change(screen.getByLabelText("The 6-digit code"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    // Provider says signed-in while the flow is still waiting on its own check: no redirect yet.
    expect(replace).not.toHaveBeenCalled();
    await act(async () => releaseFetch?.());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Share location" })).toBeTruthy();
  });
});
