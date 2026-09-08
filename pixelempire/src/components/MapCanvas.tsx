"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  MAP,
  STATUS_CODE,
  TOTAL_PLOTS,
} from "@/lib/constants";
import {
  clampViewport,
  containsBounds,
  detailLevel,
  gridIndex,
  hitTest,
  visibleGridBounds,
  zoomAtPoint,
  type GridBounds,
  type Viewport,
} from "@/lib/coords";
import { MAP_COLORS, empireColor } from "@/lib/palette";

export interface Cell {
  gridX: number;
  gridY: number;
}

export interface MapCanvasHandle {
  /** Re-fetch the visible region (after a claim, say). */
  refresh: () => void;
  /** Centre and zoom onto a plot. */
  focus: (gridX: number, gridY: number, zoom?: number) => void;
  /** Status code currently cached for a cell. */
  statusAt: (gridX: number, gridY: number) => number;
}

interface EmpireEntry {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface MapResponse {
  empires: { id: string; name: string; slug: string; avatarUrl: string | null }[];
  plots: [number, number, number, number][];
  bounds: GridBounds;
}

interface Props {
  selected: Cell | null;
  onSelect: (cell: Cell | null) => void;
  onHover?: (cell: Cell | null) => void;
  handleRef?: RefObject<MapCanvasHandle | null>;
  className?: string;
}

const POLL_MS = 20_000;
const FETCH_DEBOUNCE_MS = 140;
const TAP_SLOP_PX = 6;
const BUFFER_PLOTS = 6;

/**
 * The map.
 *
 * Everything that changes at animation-frame rate — viewport, hover cell,
 * pointer bookkeeping, the plot cache — lives in refs and is drawn by a single
 * requestAnimationFrame loop that only runs when something is actually dirty.
 * React never re-renders while you pan (§27), and hovering never touches the
 * network: status comes from a dense typed-array cache of all 10,000 plots.
 */
export default function MapCanvas({ selected, onSelect, onHover, handleRef, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- render state (never React state) ---------------------------------
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 0.5 });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const dirtyRef = useRef(true);
  const hoverRef = useRef<Cell | null>(null);
  const selectedRef = useRef<Cell | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(0);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);
  const initialisedRef = useRef(false);

  // --- plot cache -------------------------------------------------------
  const statusRef = useRef<Uint8Array>(new Uint8Array(TOTAL_PLOTS));
  const empireCellRef = useRef<Int16Array>(new Int16Array(TOTAL_PLOTS).fill(-1));
  const empiresRef = useRef<EmpireEntry[]>([]);
  const empireIdRef = useRef(new Map<string, number>());
  const loadedBoundsRef = useRef<GridBounds | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  selectedRef.current = selected;

  // ----------------------------------------------------------------- data
  const applyRegion = useCallback((data: MapResponse) => {
    const { bounds, empires, plots } = data;

    // Map this response's empire indices onto stable client-side indices.
    const localToGlobal = empires.map((empire) => {
      const known = empireIdRef.current.get(empire.id);
      if (known !== undefined) return known;
      const index = empiresRef.current.length;
      empiresRef.current.push({
        id: empire.id,
        name: empire.name,
        slug: empire.slug,
        color: empireColor(empire.id),
      });
      empireIdRef.current.set(empire.id, index);
      return index;
    });

    // The response omits unreleased plots, so clear the region first and let
    // anything absent fall back to unreleased.
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const index = gridIndex(x, y);
        statusRef.current[index] = STATUS_CODE.unreleased;
        empireCellRef.current[index] = -1;
      }
    }

    for (const [gridX, gridY, code, empireLocalIndex] of plots) {
      const index = gridIndex(gridX, gridY);
      statusRef.current[index] = code;
      empireCellRef.current[index] =
        empireLocalIndex >= 0 ? (localToGlobal[empireLocalIndex] ?? -1) : -1;
    }

    loadedBoundsRef.current = bounds;
    markDirty();
  }, [markDirty]);

  const fetchRegion = useCallback(
    async (force: boolean) => {
      const { width, height } = sizeRef.current;
      const wanted = visibleGridBounds(viewportRef.current, width, height, BUFFER_PLOTS);

      if (!force && loadedBoundsRef.current && containsBounds(loadedBoundsRef.current, wanted)) {
        return;
      }

      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      const params = new URLSearchParams({
        minX: String(wanted.minX),
        minY: String(wanted.minY),
        maxX: String(wanted.maxX),
        maxY: String(wanted.maxY),
      });

      try {
        const response = await fetch(`/api/map?${params}`, { signal: controller.signal });
        if (!response.ok) return;
        applyRegion((await response.json()) as MapResponse);
      } catch {
        // Aborted or offline: the cache stays as it is and the next settle or
        // poll tries again. A map that keeps drawing beats an error banner.
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
      }
    },
    [applyRegion],
  );

  const scheduleFetch = useCallback(
    (force = false) => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = setTimeout(() => void fetchRegion(force), FETCH_DEBOUNCE_MS);
    },
    [fetchRegion],
  );

  // ---------------------------------------------------------------- draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;

    const { width, height, dpr } = sizeRef.current;
    const viewport = viewportRef.current;
    const detail = detailLevel(viewport.zoom);
    const plotPx = MAP.plotSize * viewport.zoom;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = MAP_COLORS.void;
    context.fillRect(0, 0, width, height);

    // The world's footprint, so unreleased land reads as land, not emptiness.
    const worldX = -viewport.x * viewport.zoom;
    const worldY = -viewport.y * viewport.zoom;
    const worldW = MAP.width * viewport.zoom;
    const worldH = MAP.height * viewport.zoom;
    context.fillStyle = MAP_COLORS.unreleased;
    context.fillRect(worldX, worldY, worldW, worldH);

    const bounds = visibleGridBounds(viewport, width, height, 1);

    // Bucket cells by colour so fillStyle is set a handful of times per frame
    // instead of once per plot.
    const buckets = new Map<string, number[]>();
    const push = (color: string, x: number, y: number) => {
      let list = buckets.get(color);
      if (!list) {
        list = [];
        buckets.set(color, list);
      }
      list.push(x, y);
    };

    for (let gridY = bounds.minY; gridY <= bounds.maxY; gridY += 1) {
      for (let gridX = bounds.minX; gridX <= bounds.maxX; gridX += 1) {
        const index = gridIndex(gridX, gridY);
        const code = statusRef.current[index]!;
        if (code === STATUS_CODE.unreleased) continue;

        let color: string;
        if (code === STATUS_CODE.owned) {
          const empire = empiresRef.current[empireCellRef.current[index]!];
          color = empire ? empire.color : MAP_COLORS.available;
        } else if (code === STATUS_CODE.available) {
          color = MAP_COLORS.available;
        } else if (code === STATUS_CODE.locked) {
          color = MAP_COLORS.locked;
        } else {
          color = MAP_COLORS.disabled;
        }
        push(color, gridX, gridY);
      }
    }

    // Sub-pixel gaps at low zoom make the map look moth-eaten; overdraw by a
    // hair so founding land reads as one continent.
    const inset = detail === "low" ? 0 : Math.min(1, plotPx * 0.06);
    const size = Math.max(1, plotPx - inset * 2);

    for (const [color, cells] of buckets) {
      context.fillStyle = color;
      for (let i = 0; i < cells.length; i += 2) {
        const screenX = (cells[i]! * MAP.plotSize - viewport.x) * viewport.zoom + inset;
        const screenY = (cells[i + 1]! * MAP.plotSize - viewport.y) * viewport.zoom + inset;
        context.fillRect(screenX, screenY, size, size);
      }
    }

    // Grid appears only when a plot is big enough for it to mean something.
    if (detail !== "low" && plotPx >= 12) {
      context.strokeStyle = MAP_COLORS.grid;
      context.lineWidth = 1;
      context.beginPath();
      for (let gridX = bounds.minX; gridX <= bounds.maxX + 1; gridX += 1) {
        const screenX = Math.round((gridX * MAP.plotSize - viewport.x) * viewport.zoom) + 0.5;
        context.moveTo(screenX, Math.max(0, worldY));
        context.lineTo(screenX, Math.min(height, worldY + worldH));
      }
      for (let gridY = bounds.minY; gridY <= bounds.maxY + 1; gridY += 1) {
        const screenY = Math.round((gridY * MAP.plotSize - viewport.y) * viewport.zoom) + 0.5;
        context.moveTo(Math.max(0, worldX), screenY);
        context.lineTo(Math.min(width, worldX + worldW), screenY);
      }
      context.stroke();
    }

    const outline = (cell: Cell, color: string, lineWidth: number) => {
      const screenX = (cell.gridX * MAP.plotSize - viewport.x) * viewport.zoom;
      const screenY = (cell.gridY * MAP.plotSize - viewport.y) * viewport.zoom;
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.strokeRect(
        screenX - lineWidth / 2,
        screenY - lineWidth / 2,
        plotPx + lineWidth,
        plotPx + lineWidth,
      );
    };

    const hover = hoverRef.current;
    if (hover) outline(hover, MAP_COLORS.hover, 1.5);

    const active = selectedRef.current;
    if (active) {
      outline(active, MAP_COLORS.selected, 2.5);

      // Labels only near the selection, and only when there is room (§27).
      if (detail === "high") {
        context.font = "600 12px ui-sans-serif, system-ui, sans-serif";
        context.textBaseline = "bottom";
        let drawn = 0;
        for (let dy = -2; dy <= 2 && drawn < 8; dy += 1) {
          for (let dx = -2; dx <= 2 && drawn < 8; dx += 1) {
            const gridX = active.gridX + dx;
            const gridY = active.gridY + dy;
            if (gridX < 0 || gridY < 0 || gridX >= GRID_WIDTH || gridY >= GRID_HEIGHT) continue;
            const index = gridIndex(gridX, gridY);
            if (statusRef.current[index] !== STATUS_CODE.owned) continue;
            const empire = empiresRef.current[empireCellRef.current[index]!];
            if (!empire) continue;

            const screenX = (gridX * MAP.plotSize - viewport.x) * viewport.zoom;
            const screenY = (gridY * MAP.plotSize - viewport.y) * viewport.zoom;
            const label = empire.name.length > 18 ? `${empire.name.slice(0, 17)}…` : empire.name;
            const metrics = context.measureText(label);

            context.fillStyle = "rgba(7,8,15,0.82)";
            context.fillRect(screenX, screenY - 18, metrics.width + 10, 17);
            context.fillStyle = "#f2f4ff";
            context.fillText(label, screenX + 5, screenY - 4);
            drawn += 1;
          }
        }
      }
    }
  }, []);

  // ------------------------------------------------------------ rAF loop
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  // -------------------------------------------------------------- sizing
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      if (!initialisedRef.current && rect.width > 0) {
        initialisedRef.current = true;
        // Open on the whole world: scarcity is the first thing you should see.
        const zoom = Math.min(rect.width / MAP.width, rect.height / MAP.height);
        viewportRef.current = clampViewport({ x: 0, y: 0, zoom }, rect.width, rect.height);
        scheduleFetch(true);
      } else {
        viewportRef.current = clampViewport(viewportRef.current, rect.width, rect.height);
        scheduleFetch();
      }
      markDirty();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [markDirty, scheduleFetch]);

  // ------------------------------------------------------------- polling
  useEffect(() => {
    const timer = setInterval(() => void fetchRegion(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchRegion]);

  // ------------------------------------------------------------ gestures
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const localPoint = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const point = localPoint(event);
      pointersRef.current.set(event.pointerId, point);
      draggingRef.current = true;
      movedRef.current = 0;
      canvas.dataset.dragging = "true";
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = localPoint(event);
      const previous = pointersRef.current.get(event.pointerId);

      if (!draggingRef.current || !previous) {
        // Hover highlight is answered from the local cache — never a request.
        const cell = hitTest(point.x, point.y, viewportRef.current);
        const current = hoverRef.current;
        if (cell?.gridX !== current?.gridX || cell?.gridY !== current?.gridY) {
          hoverRef.current = cell;
          onHover?.(cell);
          markDirty();
        }
        return;
      }

      pointersRef.current.set(event.pointerId, point);
      const points = [...pointersRef.current.values()];

      if (points.length >= 2) {
        // Pinch: zoom about the midpoint between the two fingers.
        const [a, b] = points as [{ x: number; y: number }, { x: number; y: number }];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const pinch = pinchRef.current;

        if (pinch && pinch.distance > 0) {
          const { width, height } = sizeRef.current;
          viewportRef.current = zoomAtPoint(
            viewportRef.current,
            midX,
            midY,
            distance / pinch.distance,
            width,
            height,
          );
          // Two-finger drag pans as well as zooms.
          viewportRef.current = clampViewport(
            {
              ...viewportRef.current,
              x: viewportRef.current.x - (midX - pinch.midX) / viewportRef.current.zoom,
              y: viewportRef.current.y - (midY - pinch.midY) / viewportRef.current.zoom,
            },
            width,
            height,
          );
          movedRef.current += Math.abs(distance - pinch.distance);
          markDirty();
          scheduleFetch();
        }
        pinchRef.current = { distance, midX, midY };
        return;
      }

      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      movedRef.current += Math.abs(dx) + Math.abs(dy);

      const { width, height } = sizeRef.current;
      const zoom = viewportRef.current.zoom;
      viewportRef.current = clampViewport(
        {
          ...viewportRef.current,
          x: viewportRef.current.x - dx / zoom,
          y: viewportRef.current.y - dy / zoom,
        },
        width,
        height,
      );
      markDirty();
      scheduleFetch();
    };

    const endPointer = (event: PointerEvent) => {
      const point = localPoint(event);
      const wasDragging = draggingRef.current;
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size === 0) {
        draggingRef.current = false;
        canvas.dataset.dragging = "false";
      }
      canvas.releasePointerCapture?.(event.pointerId);

      // A press that barely moved is a tap: select the plot under it.
      if (wasDragging && movedRef.current <= TAP_SLOP_PX) {
        onSelect(hitTest(point.x, point.y, viewportRef.current));
        markDirty();
      }
      movedRef.current = 0;
    };

    const onPointerLeave = () => {
      if (hoverRef.current) {
        hoverRef.current = null;
        onHover?.(null);
        markDirty();
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      const { width, height } = sizeRef.current;
      // Trackpads report line/page deltas; normalise so the feel is consistent.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      const factor = Math.exp((-event.deltaY * unit) / 420);
      viewportRef.current = zoomAtPoint(viewportRef.current, point.x, point.y, factor, width, height);
      markDirty();
      scheduleFetch();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [markDirty, onHover, onSelect, scheduleFetch]);

  // -------------------------------------------------------- imperative API
  useImperativeHandle(
    handleRef,
    () => ({
      refresh: () => void fetchRegion(true),
      focus: (gridX, gridY, zoom = 6) => {
        const { width, height } = sizeRef.current;
        viewportRef.current = clampViewport(
          {
            zoom,
            x: (gridX + 0.5) * MAP.plotSize - width / (2 * zoom),
            y: (gridY + 0.5) * MAP.plotSize - height / (2 * zoom),
          },
          width,
          height,
        );
        markDirty();
        scheduleFetch();
      },
      statusAt: (gridX, gridY) => statusRef.current[gridIndex(gridX, gridY)] ?? 0,
    }),
    [fetchRegion, markDirty, scheduleFetch],
  );

  // Keyboard access: the map is not a mouse-only surface.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const current = selectedRef.current ?? { gridX: GRID_WIDTH / 2, gridY: GRID_HEIGHT / 2 };
    const moves: Record<string, Cell> = {
      ArrowUp: { gridX: current.gridX, gridY: current.gridY - step },
      ArrowDown: { gridX: current.gridX, gridY: current.gridY + step },
      ArrowLeft: { gridX: current.gridX - step, gridY: current.gridY },
      ArrowRight: { gridX: current.gridX + step, gridY: current.gridY },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    const cell = {
      gridX: Math.max(0, Math.min(GRID_WIDTH - 1, next.gridX)),
      gridY: Math.max(0, Math.min(GRID_HEIGHT - 1, next.gridY)),
    };
    onSelect(cell);
    const { width, height } = sizeRef.current;
    const viewport = viewportRef.current;
    const screenX = (cell.gridX * MAP.plotSize - viewport.x) * viewport.zoom;
    const screenY = (cell.gridY * MAP.plotSize - viewport.y) * viewport.zoom;
    if (screenX < 0 || screenY < 0 || screenX > width || screenY > height) {
      viewportRef.current = clampViewport(
        {
          ...viewport,
          x: (cell.gridX + 0.5) * MAP.plotSize - width / (2 * viewport.zoom),
          y: (cell.gridY + 0.5) * MAP.plotSize - height / (2 * viewport.zoom),
        },
        width,
        height,
      );
      scheduleFetch();
    }
    markDirty();
  };

  return (
    <div ref={containerRef} className={className}>
      <canvas
        ref={canvasRef}
        className="map-surface block h-full w-full"
        role="application"
        aria-label="PixelEmpire territory map. Use arrow keys to move between plots."
        tabIndex={0}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
