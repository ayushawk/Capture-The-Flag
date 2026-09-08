/** Map colours, shared by the canvas, the mini-maps and the share cards so a
 *  territory looks the same everywhere it appears. */

export const MAP_COLORS = {
  void: "#07080f",
  unreleased: "#111426",
  unreleasedEdge: "#191d33",
  available: "#f5b53d",
  availableEdge: "#8a5f14",
  locked: "#ff8a5c",
  disabled: "#2a2030",
  grid: "rgba(255,255,255,0.05)",
  hover: "rgba(255,255,255,0.55)",
  selected: "#ffffff",
} as const;

/**
 * A stable colour per empire, derived from its id.
 *
 * Hue is spread with the golden-angle so neighbouring empires rarely land on
 * similar colours, and saturation/lightness stay in a band that reads clearly
 * against the dark map and passes contrast against white labels.
 */
export const empireColor = (empireId: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < empireId.length; i += 1) {
    hash ^= empireId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = ((hash >>> 0) * 137.508) % 360;
  const saturation = 62 + ((hash >>> 8) % 22);
  const lightness = 58 + ((hash >>> 16) % 12);
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
};

export const formatMoney = (amountMinor: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
};

export const formatCount = (value: number): string => new Intl.NumberFormat("en-US").format(value);
