import { describe, expect, it } from "vitest";
import { addressedSeat } from "./addressed";

describe("addressedSeat", () => {
  it("finds the person a question opens with", () => {
    expect(
      addressedSeat(
        "Hi Sam and Priya, I'm Larry, an AI pal. You might both like Jojo Rabbit. Priya, have you seen Sam's pick, Spirited Away?",
        "Sam",
        "Priya",
      ),
    ).toBe("b");
    expect(addressedSeat("Qloo says you might both like Coco. Sam, have you seen it?", "Sam", "Priya")).toBe("a");
    expect(addressedSeat("So Priya, what's your favourite song?", "Sam", "Priya")).toBe("b");
  });

  it("finds the person a question ends with", () => {
    expect(addressedSeat("Which one would you pick, Sam?", "Sam", "Priya")).toBe("a");
  });

  it("ignores questions about someone, and replies with no question", () => {
    expect(addressedSeat("What do you think of Sam's pick?", "Sam", "Priya")).toBeUndefined();
    expect(addressedSeat("Priya's pick is Little Women. Have you seen it?", "Sam", "Priya")).toBeUndefined();
    expect(addressedSeat("You both like Ghibli films.", "Sam", "Priya")).toBeUndefined();
    expect(addressedSeat("Sam and Priya, what should we try?", "Sam", "Priya")).toBeUndefined();
  });

  it("gives up when both people have the same name", () => {
    expect(addressedSeat("Sam, have you seen it?", "Sam", "sam")).toBeUndefined();
  });
});
