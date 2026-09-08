/** Pure coordinate math shared by the canvas renderer, the map API and tests.
 *  No DOM, no network, no database — deliberately trivial to test. */

import { GRID_HEIGHT, GRID_WIDTH, MAP } from "./constants";

export interface Viewport {
  /** Top-left of the view, in logical map pixels. */
  x: number;
  y: number;
  /** Screen pixels per logical map pixel. */
  zoom: number;
}

export interface GridBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const gridToLogical = (grid: number): number => grid * MAP.plotSize;

export const logicalToGrid = (logical: number): number => Math.floor(logical / MAP.plotSize);

export const isValidGrid = (gridX: number, gridY: number): boolean =>
  Number.isInteger(gridX) &&
  Number.isInteger(gridY) &&
  gridX >= 0 &&
  gridX < GRID_WIDTH &&
  gridY >= 0 &&
  gridY < GRID_HEIGHT;

/** Grid index used as the dense array offset for client-side caches. */
export const gridIndex = (gridX: number, gridY: number): number => gridY * GRID_WIDTH + gridX;

export const indexToGrid = (index: number): { gridX: number; gridY: number } => ({
  gridX: index % GRID_WIDTH,
  gridY: Math.floor(index / GRID_WIDTH),
});

export const mapToScreen = (mapX: number, mapY: number, viewport: Viewport) => ({
  screenX: (mapX - viewport.x) * viewport.zoom,
  screenY: (mapY - viewport.y) * viewport.zoom,
});

export const screenToMap = (screenX: number, screenY: number, viewport: Viewport) => ({
  logicalX: viewport.x + screenX / viewport.zoom,
  logicalY: viewport.y + screenY / viewport.zoom,
});

/** Hit test: which plot is under this screen point? Null when outside the world. */
export const hitTest = (
  screenX: number,
  screenY: number,
  viewport: Viewport,
): { gridX: number; gridY: number } | null => {
  const { logicalX, logicalY } = screenToMap(screenX, screenY, viewport);
  const gridX = logicalToGrid(logicalX);
  const gridY = logicalToGrid(logicalY);
  return isValidGrid(gridX, gridY) ? { gridX, gridY } : null;
};

/** Visible grid rectangle, expanded by `bufferPlots` so panning has data ready. */
export const visibleGridBounds = (
  viewport: Viewport,
  viewWidth: number,
  viewHeight: number,
  bufferPlots = 4,
): GridBounds => {
  const minX = logicalToGrid(viewport.x) - bufferPlots;
  const minY = logicalToGrid(viewport.y) - bufferPlots;
  const maxX = logicalToGrid(viewport.x + viewWidth / viewport.zoom) + bufferPlots;
  const maxY = logicalToGrid(viewport.y + viewHeight / viewport.zoom) + bufferPlots;
  return {
    minX: clamp(minX, 0, GRID_WIDTH - 1),
    minY: clamp(minY, 0, GRID_HEIGHT - 1),
    maxX: clamp(maxX, 0, GRID_WIDTH - 1),
    maxY: clamp(maxY, 0, GRID_HEIGHT - 1),
  };
};

export const containsBounds = (outer: GridBounds, inner: GridBounds): boolean =>
  outer.minX <= inner.minX &&
  outer.minY <= inner.minY &&
  outer.maxX >= inner.maxX &&
  outer.maxY >= inner.maxY;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Keep the world on screen: never pan past the edges, never zoom past the fit. */
export const clampViewport = (
  viewport: Viewport,
  viewWidth: number,
  viewHeight: number,
  maxZoom = 24,
): Viewport => {
  const minZoom = Math.min(viewWidth / MAP.width, viewHeight / MAP.height);
  const zoom = clamp(viewport.zoom, minZoom, maxZoom);
  const spanX = viewWidth / zoom;
  const spanY = viewHeight / zoom;
  const x = spanX >= MAP.width ? (MAP.width - spanX) / 2 : clamp(viewport.x, 0, MAP.width - spanX);
  const y = spanY >= MAP.height ? (MAP.height - spanY) / 2 : clamp(viewport.y, 0, MAP.height - spanY);
  return { x, y, zoom };
};

/** Zoom about a fixed screen point, so pinch/wheel feel anchored under the finger. */
export const zoomAtPoint = (
  viewport: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
  viewWidth: number,
  viewHeight: number,
  maxZoom = 24,
): Viewport => {
  const before = screenToMap(screenX, screenY, viewport);
  const minZoom = Math.min(viewWidth / MAP.width, viewHeight / MAP.height);
  const zoom = clamp(viewport.zoom * factor, minZoom, maxZoom);
  const next: Viewport = {
    zoom,
    x: before.logicalX - screenX / zoom,
    y: before.logicalY - screenY / zoom,
  };
  return clampViewport(next, viewWidth, viewHeight, maxZoom);
};

/** Rendering detail tiers (§27): fewer labels and cheaper strokes when far out. */
export type DetailLevel = "low" | "medium" | "high";

export const detailLevel = (zoom: number): DetailLevel => {
  if (zoom < 0.9) return "low";
  if (zoom < 2.4) return "medium";
  return "high";
};
