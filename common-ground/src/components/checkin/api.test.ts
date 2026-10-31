import { describe, expect, it } from "vitest";
import { arriveSchema, leaveSchema } from "@/lib/schemas";
import { toFixBody } from "./api";

const PLACE_ID = "B7E5C0DE-1111-4222-8333-444455556666";

describe("check-in fix body", () => {
  it("clamps a very coarse fix (IP location, 50 km) so the server can answer 'fuzzy' instead of a 400", () => {
    const body = toFixBody({ lat: 19.07, lon: 72.87, accuracy: 50_000 });
    expect(body.accuracyM).toBe(5000);
    expect(arriveSchema.safeParse({ placeId: PLACE_ID, ...body }).success).toBe(true);
    expect(leaveSchema.safeParse({ visitToken: "a".repeat(20) + "." + "b".repeat(20), ...body }).success).toBe(true);
  });

  it("keeps a normal fix as it is, rounded", () => {
    expect(toFixBody({ lat: 1, lon: 2, accuracy: 12.6 })).toEqual({ lat: 1, lon: 2, accuracyM: 13 });
  });

  it("treats a broken accuracy as no usable fix", () => {
    expect(toFixBody({ lat: 1, lon: 2, accuracy: Number.NaN }).accuracyM).toBe(5000);
  });
});
