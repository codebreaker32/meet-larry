import { describe, expect, it } from "vitest";
import { CRISIS_TEXT, crisisInHistory, groupCrisisResult, unansweredCrisis } from "./crisis";

describe("crisis check over unanswered turns", () => {
  it("checks every person's turn since Larry last replied, Just us turns included", () => {
    const history = [
      { role: "assistant", content: "Hi all." },
      { role: "user", content: "[Jo] i wanna die" },
      { role: "user", content: "[Sam] lol what" },
      { role: "user", content: "[Priya] what should we watch?" },
    ];
    expect(crisisInHistory(history)).toBe(true);
    expect(unansweredCrisis({ history })).toBe(true);
  });

  it("doesn't repeat once Larry has replied after the line", () => {
    const history = [
      { role: "user", content: "[Jo] i wanna die" },
      { role: "assistant", content: CRISIS_TEXT },
      { role: "user", content: "[Jo] ok, what should we play?" },
    ];
    expect(crisisInHistory(history)).toBe(false);
  });

  it("gives a fixed group reply", () => {
    expect(groupCrisisResult()).toEqual({ messages: [{ from: "larry", text: CRISIS_TEXT }], quiet: false, steps: [], profileUpdates: [], crisis: true });
  });
});
