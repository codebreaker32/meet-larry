// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSpeechToText } from "./use-speech";

type Res = { resultIndex: number; results: ({ isFinal: boolean } & { transcript: string }[])[] };
let rec: FakeRec | null = null;
const starts: string[] = [];
class FakeRec {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((e: Res) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  start() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    rec = this;
    starts.push(this.lang);
  }
  stop() {
    this.onend?.();
  }
  abort() {}
}
const said = (t: string, isFinal: boolean): Res => ({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal })] });

beforeEach(() => {
  localStorage.clear();
  starts.length = 0;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRec;
});
afterEach(cleanup);

describe("useSpeechToText", () => {
  it("is continuous with live words, listens on through the browser's own cut-off, and stops only on stop", () => {
    const onText = vi.fn();
    const { result } = renderHook(() => useSpeechToText(onText));
    expect(result.current.supported).toBe(true);
    act(() => result.current.start("Hi"));
    expect(rec!.continuous).toBe(true);
    expect(rec!.interimResults).toBe(true);
    expect(rec!.lang).toBe("en-IN");
    act(() => rec!.onresult!(said("I like", false)));
    expect(onText).toHaveBeenLastCalledWith("Hi I like");
    act(() => rec!.onresult!(said("I like chess", true)));
    // A long pause: the browser ends recognition, and it starts again by itself.
    act(() => rec!.onend!());
    expect(result.current.listening).toBe(true);
    expect(starts).toHaveLength(2);
    act(() => rec!.onresult!(said("and tea", true)));
    expect(onText).toHaveBeenLastCalledWith("Hi I like chess and tea");
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it("switches to Hindi while listening and remembers it", () => {
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    act(() => result.current.setLang("hi-IN"));
    expect(starts.at(-1)).toBe("hi-IN");
    expect(result.current.lang).toBe("hi-IN");
    expect(JSON.parse(localStorage.getItem("larry.speechLang")!)).toBe("hi-IN");
  });

  it("stops for good on a blocked mic, with a warm line", () => {
    const { result } = renderHook(() => useSpeechToText(() => {}));
    act(() => result.current.start());
    act(() => rec!.onerror!({ error: "not-allowed" }));
    act(() => rec!.onend!());
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toMatch(/turn it on in your browser settings/i);
  });
});
