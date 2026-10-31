import { describe, expect, it } from "vitest";
import { chatSchema, placesSchema, safeImage } from "./schemas";

const pair = { a: { name: "Sam", items: [] }, b: { name: "Priya", items: [] }, history: [] };

describe("chatSchema stepsDone", () => {
  it("is optional", () => expect(chatSchema.parse(pair).stepsDone).toBeUndefined());
  it("accepts whole numbers and counts more than 50 as 50", () => {
    expect(chatSchema.parse({ ...pair, stepsDone: 2 }).stepsDone).toBe(2);
    expect(chatSchema.parse({ ...pair, stepsDone: 900 }).stepsDone).toBe(50);
  });
  it("rejects negative, fractional or non-number values", () => {
    for (const v of [-1, 1.5, "2"]) expect(chatSchema.safeParse({ ...pair, stepsDone: v }).success).toBe(false);
  });
});

describe("safeImage", () => {
  it("keeps short https images and drops the rest", () => {
    expect(safeImage("https://images.qloo.com/i/x.jpg")).toBe("https://images.qloo.com/i/x.jpg");
    expect(safeImage("http://images.qloo.com/i/x.jpg")).toBeUndefined();
    expect(safeImage(`https://images.qloo.com/${"x".repeat(300)}.jpg`)).toBeUndefined();
    expect(safeImage(undefined)).toBeUndefined();
  });
});

describe("placesSchema", () => {
  it("takes items and ignores the old ids field", () => {
    const v = placesSchema.parse({ lat: 1, lon: 2, ids: ["a"], items: [{ id: "a", name: "Minecraft" }] });
    expect(v).toEqual({ lat: 1, lon: 2, items: [{ id: "a", name: "Minecraft" }] });
  });
  it("needs at least one item", () => {
    expect(placesSchema.safeParse({ lat: 1, lon: 2, ids: ["a"] }).success).toBe(false);
    expect(placesSchema.safeParse({ lat: 1, lon: 2, items: [] }).success).toBe(false);
  });
});
