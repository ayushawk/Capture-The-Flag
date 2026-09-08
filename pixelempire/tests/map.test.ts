import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  FOUNDING_INVENTORY,
  GRID_HEIGHT,
  GRID_WIDTH,
  PIXELS_PER_PLOT,
  PLOT_STATUS,
  TOTAL_LOGICAL_PIXELS,
  TOTAL_PLOTS,
} from "@/lib/constants";
import { getMapRegion, getStats } from "@/server/services/read";
import { resetDynamicData } from "./helpers";

describe("map inventory (§3, §45)", () => {
  beforeAll(async () => {
    await resetDynamicData();
  });

  it("contains exactly 10,000 plots", async () => {
    expect(await prisma.plot.count()).toBe(TOTAL_PLOTS);
    expect(TOTAL_PLOTS).toBe(10_000);
  });

  it("releases 1,000 founding plots and holds back 9,000", async () => {
    const [available, unreleased] = await Promise.all([
      prisma.plot.count({ where: { status: PLOT_STATUS.available } }),
      prisma.plot.count({ where: { status: PLOT_STATUS.unreleased } }),
    ]);
    expect(available).toBe(FOUNDING_INVENTORY);
    expect(unreleased).toBe(TOTAL_PLOTS - FOUNDING_INVENTORY);
  });

  it("stores unreleased plots rather than omitting them", async () => {
    // §6: "Do not physically omit unreleased plots."
    const rows = await prisma.plot.count({ where: { status: PLOT_STATUS.unreleased } });
    expect(rows).toBe(9_000);
  });

  it("covers every coordinate in the grid exactly once", async () => {
    const extremes = await prisma.plot.aggregate({
      _min: { gridX: true, gridY: true },
      _max: { gridX: true, gridY: true },
    });
    expect(extremes._min.gridX).toBe(0);
    expect(extremes._min.gridY).toBe(0);
    expect(extremes._max.gridX).toBe(GRID_WIDTH - 1);
    expect(extremes._max.gridY).toBe(GRID_HEIGHT - 1);

    const distinct = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT (grid_x, grid_y)) AS count FROM "plots"`;
    expect(Number(distinct[0]!.count)).toBe(TOTAL_PLOTS);
  });

  it("gives every plot the same 10x10 footprint", async () => {
    const odd = await prisma.plot.count({ where: { OR: [{ pixelWidth: { not: 10 } }, { pixelHeight: { not: 10 } }] } });
    expect(odd).toBe(0);
    expect(PIXELS_PER_PLOT).toBe(100);
    expect(TOTAL_PLOTS * PIXELS_PER_PLOT).toBe(TOTAL_LOGICAL_PIXELS);
  });

  it("reports founding land as 100,000 logical pixels", async () => {
    const stats = await getStats();
    expect(stats.totalPixels).toBe(1_000_000);
    expect(stats.foundingPlots).toBe(1_000);
    expect(stats.foundingPixels).toBe(100_000);
    expect(stats.claimedPlots).toBe(0);
  });

  it("returns a viewport-limited region and omits unreleased land", async () => {
    const region = await getMapRegion({ minX: 45, minY: 45, maxX: 54, maxY: 54 });
    expect(region.map.gridWidth).toBe(GRID_WIDTH);
    expect(region.plots.length).toBeGreaterThan(0);
    for (const [gridX, gridY, code] of region.plots) {
      expect(gridX).toBeGreaterThanOrEqual(45);
      expect(gridX).toBeLessThanOrEqual(54);
      expect(gridY).toBeGreaterThanOrEqual(45);
      expect(gridY).toBeLessThanOrEqual(54);
      // 0 = unreleased, which the wire format never sends.
      expect(code).not.toBe(0);
    }
  });

  it("does not leak private user data through the map", async () => {
    const region = await getMapRegion({ minX: 0, minY: 0, maxX: 99, maxY: 99 });
    const serialised = JSON.stringify(region);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain("email");
  });
});
