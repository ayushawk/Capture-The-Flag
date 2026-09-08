"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import MapCanvas, { type Cell, type MapCanvasHandle } from "./MapCanvas";
import ClaimPanel from "./ClaimPanel";
import ShareRow from "./ShareRow";
import type { PlotDetail } from "@/server/services/read";
import { formatCount } from "@/lib/palette";
import { MAP_COLORS } from "@/lib/palette";

interface Props {
  signedIn: boolean;
  userEmail: string | null;
  ownedPlotIds: string[];
  empireSlug: string | null;
  initial: { x: number; y: number } | null;
  stats: { availablePlots: number; claimedPlots: number; empires: number };
}

/** The claim loop, end to end: explore, tap, claim, pay, own, share (§29). */
export default function MapExperience({
  signedIn,
  userEmail,
  ownedPlotIds,
  empireSlug,
  initial,
  stats,
}: Props) {
  const mapRef = useRef<MapCanvasHandle | null>(null);
  const [selected, setSelected] = useState<Cell | null>(initial ? { gridX: initial.x, gridY: initial.y } : null);
  const [plot, setPlot] = useState<PlotDetail | null>(null);
  const [loadingPlot, setLoadingPlot] = useState(false);
  const [owned, setOwned] = useState<Set<string>>(new Set(ownedPlotIds));
  const [claimedSlug, setClaimedSlug] = useState<string | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  // Deep link: /map?x=&y= opens on that plot.
  useEffect(() => {
    if (initial) mapRef.current?.focus(initial.x, initial.y, 8);
  }, [initial]);

  useEffect(() => {
    if (!selected) {
      setPlot(null);
      return;
    }
    let cancelled = false;
    setLoadingPlot(true);

    fetch(`/api/plots?x=${selected.gridX}&y=${selected.gridY}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: PlotDetail | null) => {
        if (!cancelled) setPlot(data);
      })
      .catch(() => {
        if (!cancelled) setPlot(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlot(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const onClaimed = useCallback(
    (slug: string) => {
      setClaimedSlug(slug || empireSlug || "");
      if (plot) setOwned((current) => new Set(current).add(plot.id));
      mapRef.current?.refresh();
      // Re-read the plot so the panel shows the new owner.
      if (selected) {
        fetch(`/api/plots?x=${selected.gridX}&y=${selected.gridY}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((data: PlotDetail | null) => data && setPlot(data))
          .catch(() => undefined);
      }
    },
    [empireSlug, plot, selected],
  );

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full overflow-hidden">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <MapCanvas
        handleRef={mapRef}
        selected={selected}
        onSelect={setSelected}
        onHover={setHover}
        className="absolute inset-0"
      />

      {/* Legend + live counts. Pointer-events off so the map stays draggable. */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="panel pointer-events-auto rounded-xl px-4 py-3 text-xs">
          <p className="mb-2 font-semibold uppercase tracking-[0.16em] text-[--color-ink-faint]">The world</p>
          <Legend color={MAP_COLORS.available} label={`${formatCount(stats.availablePlots)} founding plots left`} />
          <Legend color="#6f7bff" label={`${formatCount(stats.claimedPlots)} claimed`} />
          <Legend color={MAP_COLORS.locked} label="Being claimed" />
          <Legend color={MAP_COLORS.unreleased} label="Unreleased land" />
        </div>
        {hover && (
          <div className="panel pointer-events-none rounded-lg px-3 py-1.5 font-mono text-xs tabular text-[--color-ink-soft]">
            {hover.gridX}, {hover.gridY}
          </div>
        )}
      </div>

      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-xs text-[--color-ink-faint] md:bottom-6">
        Drag to explore · scroll or pinch to zoom · tap a plot to claim it
      </p>

      {/* Bottom sheet on mobile, side panel on desktop. */}
      {(selected || loadingPlot) && (
        <div className="absolute inset-x-0 bottom-0 z-10 md:inset-y-0 md:left-auto md:right-0 md:flex md:w-[380px] md:items-center md:p-4">
          <div className="w-full">
            <ClaimPanel
              plot={plot}
              loading={loadingPlot}
              signedIn={signedIn}
              userEmail={userEmail}
              ownedByYou={plot ? owned.has(plot.id) : false}
              onClaimed={onClaimed}
              onClose={() => setSelected(null)}
            />

            {claimedSlug !== null && plot && (
              <div className="panel mt-3 rounded-2xl p-5">
                <h3 className="font-display text-xl">Your territory is live.</h3>
                <p className="mt-1 text-sm text-[--color-ink-soft]">
                  Give your empire a name, then tell the world.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/empire"
                    className="rounded-lg bg-[--color-gold] px-4 py-2 text-sm font-semibold text-[--color-void]"
                  >
                    Customise empire
                  </Link>
                  {claimedSlug && (
                    <Link
                      href={`/e/${claimedSlug}`}
                      className="rounded-lg border border-[--color-edge] px-4 py-2 text-sm"
                    >
                      View empire page
                    </Link>
                  )}
                </div>
                {claimedSlug && (
                  <ShareRow
                    className="mt-4"
                    slug={claimedSlug}
                    gridX={plot.gridX}
                    gridY={plot.gridY}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[--color-ink-soft]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </div>
  );
}
