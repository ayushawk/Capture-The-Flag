import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/constants";
import { empireColor } from "@/lib/palette";

interface Props {
  empireId: string;
  territories: { gridX: number; gridY: number }[];
  className?: string;
}

/**
 * A small SVG of where an empire sits in the world. Server-rendered, so it is
 * in the HTML of the empire page and inside link previews without a canvas.
 */
export default function TerritoryMap({ empireId, territories, className = "" }: Props) {
  const color = empireColor(empireId);

  return (
    <svg
      viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
      className={className}
      role="img"
      aria-label={`Map showing ${territories.length} claimed plot${territories.length === 1 ? "" : "s"}`}
    >
      <rect width={GRID_WIDTH} height={GRID_HEIGHT} fill="#111426" />
      {territories.map((plot) => (
        <rect
          key={`${plot.gridX}-${plot.gridY}`}
          x={plot.gridX}
          y={plot.gridY}
          width={1}
          height={1}
          fill={color}
        />
      ))}
      {/* A ring around the holdings so a single plot is still findable. */}
      {territories.length > 0 && (
        <rect
          x={Math.max(0, Math.min(...territories.map((p) => p.gridX)) - 3)}
          y={Math.max(0, Math.min(...territories.map((p) => p.gridY)) - 3)}
          width={Math.min(
            GRID_WIDTH,
            Math.max(...territories.map((p) => p.gridX)) - Math.min(...territories.map((p) => p.gridX)) + 7,
          )}
          height={Math.min(
            GRID_HEIGHT,
            Math.max(...territories.map((p) => p.gridY)) - Math.min(...territories.map((p) => p.gridY)) + 7,
          )}
          fill="none"
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={0.5}
        />
      )}
    </svg>
  );
}
