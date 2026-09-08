import { ImageResponse } from "next/og";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/constants";
import { empireColor, formatCount } from "@/lib/palette";
import { getPublicEmpire } from "@/server/services/read";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "PixelEmpire empire card";
// Prisma runs here, so this must stay on the Node runtime.
export const runtime = "nodejs";

/**
 * The share card (§30): empire name, holdings and where they sit on the world,
 * generated per empire so a posted link previews as a territory rather than a
 * generic logo. Public fields only.
 */
export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let empire: Awaited<ReturnType<typeof getPublicEmpire>> | null = null;
  try {
    empire = await getPublicEmpire(slug);
  } catch {
    empire = null;
  }

  const name = empire?.name ?? "PixelEmpire";
  const color = empire ? empireColor(empire.id) : "#f5b53d";
  const mapPx = 380;
  const cell = mapPx / GRID_WIDTH;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#07080f",
          color: "#f2f4ff",
          fontFamily: "sans-serif",
          padding: 64,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <div style={{ width: 18, height: 18, background: "#f5b53d", borderRadius: 4 }} />
            <span style={{ fontSize: 22, letterSpacing: 3, color: "#a8aecb" }}>PIXELEMPIRE</span>
          </div>

          <div style={{ fontSize: name.length > 22 ? 62 : 78, fontWeight: 700, lineHeight: 1.05 }}>
            {name}
          </div>

          {empire ? (
            <div style={{ display: "flex", gap: 40, marginTop: 40 }}>
              <Stat label="PLOTS" value={formatCount(empire.plots)} />
              <Stat label="PIXELS" value={formatCount(empire.pixels)} />
              <Stat label="RANK" value={empire.rank ? `#${empire.rank}` : "—"} />
            </div>
          ) : (
            <div style={{ marginTop: 32, fontSize: 30, color: "#a8aecb" }}>
              Own a piece of the internet.
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            position: "relative",
            width: mapPx,
            height: mapPx,
            background: "#111426",
            borderRadius: 20,
            border: "1px solid #232842",
          }}
        >
          {(empire?.territories ?? []).slice(0, 400).map((plot) => (
            <div
              key={`${plot.gridX}-${plot.gridY}`}
              style={{
                position: "absolute",
                left: plot.gridX * cell,
                top: plot.gridY * (mapPx / GRID_HEIGHT),
                width: Math.max(4, cell),
                height: Math.max(4, mapPx / GRID_HEIGHT),
                background: color,
                borderRadius: 2,
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 16, letterSpacing: 2, color: "#6a7196" }}>{label}</span>
      <span style={{ fontSize: 42, fontWeight: 700, marginTop: 6 }}>{value}</span>
    </div>
  );
}
