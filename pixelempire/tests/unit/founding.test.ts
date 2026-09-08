import { describe, expect, it } from "vitest";
import { foundingGridKeys } from "@/lib/founding";
import { FOUNDING_INVENTORY, TOTAL_PLOTS } from "@/lib/constants";

describe("founding release selection", () => {
  it("selects exactly the founding inventory", () => {
    expect(foundingGridKeys(FOUNDING_INVENTORY).size).toBe(FOUNDING_INVENTORY);
  });

  it("is deterministic across runs, which is what makes the seed idempotent", () => {
    const first = [...foundingGridKeys(FOUNDING_INVENTORY)].sort((a, b) => a - b);
    const second = [...foundingGridKeys(FOUNDING_INVENTORY)].sort((a, b) => a - b);
    expect(first).toEqual(second);
  });

  it("keeps every key inside the grid", () => {
    for (const key of foundingGridKeys(FOUNDING_INVENTORY)) {
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThan(TOTAL_PLOTS);
    }
  });

  it("clusters the release around the centre of the world", () => {
    const keys = foundingGridKeys(FOUNDING_INVENTORY);
    expect(keys.has(49 * 100 + 49)).toBe(true);
    expect(keys.has(0)).toBe(false);
    expect(keys.has(99 * 100 + 99)).toBe(false);
  });
});
