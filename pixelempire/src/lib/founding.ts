import { GRID_HEIGHT, GRID_WIDTH } from "./constants";

/**
 * Which plots belong to the founding release.
 *
 * The founding plots are the `count` plots closest to the centre of the world,
 * which renders as a single round island of claimable land surrounded by
 * unreleased territory — scarcity you can see at a glance (§28).
 *
 * Deterministic: ties break on (y, x), so the same set comes out on every run
 * and the seed stays idempotent.
 */
export const foundingGridKeys = (count: number): Set<number> => {
  const centreX = (GRID_WIDTH - 1) / 2;
  const centreY = (GRID_HEIGHT - 1) / 2;

  const cells: { key: number; d2: number; y: number; x: number }[] = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const dx = x - centreX;
      const dy = y - centreY;
      cells.push({ key: y * GRID_WIDTH + x, d2: dx * dx + dy * dy, y, x });
    }
  }

  cells.sort((a, b) => a.d2 - b.d2 || a.y - b.y || a.x - b.x);
  return new Set(cells.slice(0, count).map((cell) => cell.key));
};
