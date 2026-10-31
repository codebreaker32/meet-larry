import { describe, expect, it } from "vitest";
import {
  LARRY_COMMANDS,
  LARRY_COMMAND_IDS,
  commandText,
  filterLarryCommands,
  parseLarryCommand,
} from "./larry-commands";

describe("parseLarryCommand", () => {
  it("reads every slash command", () => {
    for (const id of LARRY_COMMAND_IDS) {
      expect(parseLarryCommand(`/${id}`)).toEqual({ kind: "command", cmd: id, args: "", via: "slash" });
    }
  });

  it("keeps args", () => {
    expect(parseLarryCommand("/plan  saturday 11am ")).toEqual({
      kind: "command",
      cmd: "plan",
      args: "saturday 11am",
      via: "slash",
    });
    expect(parseLarryCommand("/MATCH_DAY")).toMatchObject({ cmd: "matchday" });
  });

  it("ignores unknown slash words and plain chat", () => {
    expect(parseLarryCommand("/banana")).toEqual({ kind: "none" });
    expect(parseLarryCommand("see you at 6")).toEqual({ kind: "none" });
    expect(parseLarryCommand("")).toEqual({ kind: "none" });
    expect(parseLarryCommand("I told Larry about it")).toEqual({ kind: "none" });
  });

  it("reads @Larry with a command word", () => {
    expect(parseLarryCommand("@Larry plan for sunday")).toEqual({
      kind: "command",
      cmd: "plan",
      args: "for sunday",
      via: "mention",
    });
    expect(parseLarryCommand("@larry, gems")).toMatchObject({ kind: "command", cmd: "gems" });
    expect(parseLarryCommand("@Larry match day this week?")).toMatchObject({ cmd: "matchday", args: "this week?" });
    expect(parseLarryCommand("@Larry /twin")).toMatchObject({ cmd: "twin", via: "mention" });
  });

  it("treats @Larry with anything else as a question", () => {
    expect(parseLarryCommand("@Larry what should we eat?")).toEqual({ kind: "ask", text: "what should we eat?" });
    expect(parseLarryCommand("@Larry big day today")).toEqual({ kind: "ask", text: "big day today" });
  });

  it("bare @Larry opens help", () => {
    expect(parseLarryCommand("@Larry")).toMatchObject({ kind: "command", cmd: "help" });
  });
});

describe("metadata", () => {
  it("lists every command once, in id order, with label, hint and icon", () => {
    expect(LARRY_COMMANDS.map((c) => c.cmd)).toEqual([...LARRY_COMMAND_IDS]);
    for (const c of LARRY_COMMANDS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeLessThanOrEqual(60);
      expect(c.icon).toMatch(/^[A-Z]/);
    }
  });

  it("menu sends the slash form", () => {
    expect(commandText("plan")).toBe("/plan");
    expect(commandText("mood", " tired ")).toBe("/mood tired");
    expect(parseLarryCommand(commandText("matchday"))).toMatchObject({ cmd: "matchday" });
  });

  it("filters by typed prefix", () => {
    expect(filterLarryCommands("@").length).toBe(LARRY_COMMANDS.length);
    expect(filterLarryCommands("/ma").map((c) => c.cmd)).toEqual(["matchday"]);
    expect(filterLarryCommands("@Larry com").map((c) => c.cmd)).toEqual(["together"]);
    expect(filterLarryCommands("", { group: false }).some((c) => c.cmd === "together")).toBe(false);
  });
});
