import { describe, expect, it } from "vitest";
import {
  clampViewport,
  gridIndex,
  gridToLogical,
  hitTest,
  indexToGrid,
  isValidGrid,
  logicalToGrid,
  screenToMap,
  visibleGridBounds,
  zoomAtPoint,
} from "@/lib/coords";
import { GRID_WIDTH, MAP } from "@/lib/constants";

describe("coordinate system (§26)", () => {
  it("converts grid to logical pixels", () => {
    expect(gridToLogical(0)).toBe(0);
    expect(gridToLogical(1)).toBe(10);
    expect(gridToLogical(99)).toBe(990);
  });

  it("converts logical pixels back to grid", () => {
    expect(logicalToGrid(0)).toBe(0);
    expect(logicalToGrid(9)).toBe(0);
    expect(logicalToGrid(10)).toBe(1);
    expect(logicalToGrid(999)).toBe(99);
  });

  it("round-trips every plot through the dense index", () => {
    for (const [gridX, gridY] of [[0, 0], [99, 99], [42, 17], [7, 63]] as const) {
      const index = gridIndex(gridX, gridY);
      expect(indexToGrid(index)).toEqual({ gridX, gridY });
    }
  });

  it("rejects coordinates outside the world", () => {
    expect(isValidGrid(0, 0)).toBe(true);
    expect(isValidGrid(99, 99)).toBe(true);
    expect(isValidGrid(-1, 0)).toBe(false);
    expect(isValidGrid(100, 0)).toBe(false);
    expect(isValidGrid(1.5, 0)).toBe(false);
  });

  it("hit tests a screen point back to the plot under it", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    expect(hitTest(0, 0, viewport)).toEqual({ gridX: 0, gridY: 0 });
    expect(hitTest(425, 175, viewport)).toEqual({ gridX: 42, gridY: 17 });
    expect(hitTest(-5, 5, viewport)).toBeNull();
    expect(hitTest(5000, 5, viewport)).toBeNull();
  });

  it("hit tests correctly when panned and zoomed", () => {
    const viewport = { x: 200, y: 300, zoom: 2.5 };
    const target = { gridX: 42, gridY: 37 };
    const screenX = (target.gridX * MAP.plotSize + 5 - viewport.x) * viewport.zoom;
    const screenY = (target.gridY * MAP.plotSize + 5 - viewport.y) * viewport.zoom;
    expect(hitTest(screenX, screenY, viewport)).toEqual(target);
  });

  it("keeps the world inside the viewport when clamping", () => {
    const clamped = clampViewport({ x: -500, y: 5000, zoom: 4 }, 800, 600);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeLessThanOrEqual(MAP.height);
    expect(clamped.x + 800 / clamped.zoom).toBeLessThanOrEqual(MAP.width + 1e-6);
  });

  it("never zooms out past the whole map", () => {
    const clamped = clampViewport({ x: 0, y: 0, zoom: 0.0001 }, 800, 800);
    expect(clamped.zoom).toBeCloseTo(0.8, 5);
  });

  it("anchors zoom to the point under the cursor", () => {
    const viewport = { x: 100, y: 100, zoom: 2 };
    const before = screenToMap(400, 300, viewport);
    const zoomed = zoomAtPoint(viewport, 400, 300, 1.5, 800, 600);
    const after = screenToMap(400, 300, zoomed);
    expect(after.logicalX).toBeCloseTo(before.logicalX, 4);
    expect(after.logicalY).toBeCloseTo(before.logicalY, 4);
  });

  it("expands visible bounds by the buffer but stays inside the grid", () => {
    const bounds = visibleGridBounds({ x: 0, y: 0, zoom: 1 }, 200, 200, 4);
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(24);
    expect(bounds.maxX).toBeLessThan(GRID_WIDTH);
  });
});
