import { prisma, toNumber } from "@/lib/db";
import {
  CODE_STATUS,
  FOUNDING_INVENTORY,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAP,
  PIXELS_PER_PLOT,
  PLOT_STATUS,
  PLOT_TIER,
  PURCHASE_STATUS,
  STATUS_CODE,
  TOTAL_LOGICAL_PIXELS,
  TOTAL_PLOTS,
  type PlotStatus,
} from "@/lib/constants";
import { notFound } from "@/lib/http";
import type { GridBounds } from "@/lib/coords";

/** Public shape of an empire wherever one is referenced. Never includes email. */
export interface EmpireSummary {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
}

export interface MapRegion {
  map: {
    width: number;
    height: number;
    plotSize: number;
    gridWidth: number;
    gridHeight: number;
  };
  bounds: GridBounds;
  empires: EmpireSummary[];
  /**
   * `[gridX, gridY, statusCode, empireIndex]`, where `empireIndex` points into
   * `empires` and is -1 when unowned.
   *
   * Plots that are `unreleased` are omitted: they are 90% of the world in V1
   * and the client treats any cell inside `bounds` that is missing from this
   * list as unreleased. Same information, a fraction of the bytes.
   */
  plots: [number, number, number, number][];
}

/** Viewport-aware map read (§22). Public ownership data only. */
export const getMapRegion = async (bounds: GridBounds): Promise<MapRegion> => {
  const plots = await prisma.plot.findMany({
    where: {
      gridX: { gte: bounds.minX, lte: bounds.maxX },
      gridY: { gte: bounds.minY, lte: bounds.maxY },
      status: { not: PLOT_STATUS.unreleased },
    },
    select: {
      gridX: true,
      gridY: true,
      status: true,
      ownerEmpire: { select: { id: true, name: true, slug: true, avatarUrl: true } },
    },
  });

  const empires: EmpireSummary[] = [];
  const empireIndex = new Map<string, number>();

  const rows = plots.map((plot): [number, number, number, number] => {
    let index = -1;
    if (plot.ownerEmpire) {
      const existing = empireIndex.get(plot.ownerEmpire.id);
      if (existing === undefined) {
        index = empires.length;
        empireIndex.set(plot.ownerEmpire.id, index);
        empires.push(plot.ownerEmpire);
      } else {
        index = existing;
      }
    }
    return [plot.gridX, plot.gridY, STATUS_CODE[plot.status as PlotStatus] ?? 0, index];
  });

  return {
    map: {
      width: MAP.width,
      height: MAP.height,
      plotSize: MAP.plotSize,
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
    },
    bounds,
    empires,
    plots: rows,
  };
};

export interface PlotDetail {
  id: string;
  gridX: number;
  gridY: number;
  logicalX: number;
  logicalY: number;
  pixelWidth: number;
  pixelHeight: number;
  status: string;
  tier: string;
  ownedAt: string | null;
  empire: (EmpireSummary & { description: string | null; xUsername: string | null }) | null;
  /** Present while a reservation is counting down, so the UI can say so. */
  lockedUntil: string | null;
}

export const getPlotDetail = async (plotId: string): Promise<PlotDetail> => {
  const plot = await prisma.plot.findUnique({
    where: { id: plotId },
    include: {
      ownerEmpire: {
        select: { id: true, name: true, slug: true, avatarUrl: true, description: true, xUsername: true },
      },
      locks: {
        where: { releasedAt: null, expiresAt: { gt: new Date() } },
        select: { expiresAt: true },
        take: 1,
      },
    },
  });

  if (!plot) throw notFound("That plot does not exist");

  return {
    id: plot.id,
    gridX: plot.gridX,
    gridY: plot.gridY,
    logicalX: plot.gridX * MAP.plotSize,
    logicalY: plot.gridY * MAP.plotSize,
    pixelWidth: plot.pixelWidth,
    pixelHeight: plot.pixelHeight,
    status: plot.status,
    tier: plot.tier,
    ownedAt: plot.ownedAt?.toISOString() ?? null,
    empire: plot.ownerEmpire,
    lockedUntil: plot.locks[0]?.expiresAt.toISOString() ?? null,
  };
};

/** Coordinate lookup, used by the deep-linked `/map?x=&y=` view. */
export const getPlotByGrid = async (gridX: number, gridY: number): Promise<PlotDetail> => {
  const plot = await prisma.plot.findUnique({
    where: { gridX_gridY: { gridX, gridY } },
    select: { id: true },
  });
  if (!plot) throw notFound("That plot does not exist");
  return getPlotDetail(plot.id);
};

export interface PlatformStats {
  totalPixels: number;
  totalPlots: number;
  foundingPlots: number;
  foundingPixels: number;
  availablePlots: number;
  claimedPlots: number;
  claimedPixels: number;
  empires: number;
  totalSpentMinor: number;
  currency: string;
}

/** Live stats for the landing hero (§2). */
export const getStats = async (): Promise<PlatformStats> => {
  const [claimedPlots, availablePlots, foundingPlots, empires, spend] = await Promise.all([
    prisma.plot.count({ where: { status: PLOT_STATUS.owned } }),
    prisma.plot.count({ where: { status: PLOT_STATUS.available } }),
    prisma.plot.count({ where: { tier: PLOT_TIER.founding } }),
    prisma.empire.count({ where: { plots: { some: {} } } }),
    prisma.purchase.aggregate({
      where: { status: PURCHASE_STATUS.completed },
      _sum: { amountMinor: true },
      _count: true,
    }),
  ]);

  const currency =
    (await prisma.pricingRule.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: { currency: true },
    }))?.currency ?? "USD";

  return {
    totalPixels: TOTAL_LOGICAL_PIXELS,
    totalPlots: TOTAL_PLOTS,
    foundingPlots: foundingPlots || FOUNDING_INVENTORY,
    foundingPixels: (foundingPlots || FOUNDING_INVENTORY) * PIXELS_PER_PLOT,
    availablePlots,
    claimedPlots,
    claimedPixels: claimedPlots * PIXELS_PER_PLOT,
    empires,
    totalSpentMinor: toNumber(spend._sum.amountMinor ?? BigInt(0)),
    currency,
  };
};

export interface LeaderboardRow {
  rank: number;
  empire: EmpireSummary;
  plots: number;
  pixels: number;
}

/**
 * V1 leaderboard (§31): largest empires by total logical pixels owned. Every V1
 * plot is the same size, so this is plot count in disguise — but the pixel
 * figure is what is stored and displayed, which keeps the ordering meaningful
 * if plot sizes ever vary.
 */
export const getLeaderboard = async (limit = 50): Promise<LeaderboardRow[]> => {
  const rows = await prisma.$queryRaw<
    { id: string; name: string; slug: string; avatar_url: string | null; plots: bigint; rank: bigint }[]
  >`
    SELECT e.id, e.name, e.slug, e.avatar_url,
           COUNT(p.id) AS plots,
           RANK() OVER (ORDER BY COUNT(p.id) DESC) AS rank
    FROM "empires" e
    JOIN "plots" p ON p.owner_empire_id = e.id AND p.status = 'owned'
    GROUP BY e.id, e.name, e.slug, e.avatar_url
    ORDER BY plots DESC, e.created_at ASC
    LIMIT ${limit}`;

  return rows.map((row) => ({
    rank: Number(row.rank),
    empire: { id: row.id, name: row.name, slug: row.slug, avatarUrl: row.avatar_url },
    plots: Number(row.plots),
    pixels: Number(row.plots) * PIXELS_PER_PLOT,
  }));
};

export interface ActivityRow {
  id: string;
  type: string;
  createdAt: string;
  empire: { name: string; slug: string } | null;
  plot: { gridX: number; gridY: number } | null;
}

/** Recent public events (§21). Deliberately carries no payment information. */
export const getActivity = async (limit = 20): Promise<ActivityRow[]> => {
  const events = await prisma.activityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      createdAt: true,
      empire: { select: { name: true, slug: true } },
      plot: { select: { gridX: true, gridY: true } },
    },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.eventType,
    createdAt: event.createdAt.toISOString(),
    empire: event.empire,
    plot: event.plot,
  }));
};

export interface PublicEmpire {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  xUsername: string | null;
  websiteUrl: string | null;
  createdAt: string;
  plots: number;
  pixels: number;
  rank: number | null;
  territories: { id: string; gridX: number; gridY: number; ownedAt: string | null }[];
}

export const getPublicEmpire = async (slug: string): Promise<PublicEmpire> => {
  const empire = await prisma.empire.findUnique({
    where: { slug },
    include: {
      plots: {
        where: { status: PLOT_STATUS.owned },
        select: { id: true, gridX: true, gridY: true, ownedAt: true },
        orderBy: [{ gridY: "asc" }, { gridX: "asc" }],
        take: 500,
      },
    },
  });

  if (!empire) throw notFound("No empire at that address");

  const plots = empire.plots.length;

  // Rank is only meaningful once an empire holds land.
  const rank =
    plots === 0
      ? null
      : Number(
          (
            await prisma.$queryRaw<{ rank: bigint }[]>`
              SELECT COUNT(*) + 1 AS rank FROM (
                SELECT owner_empire_id, COUNT(*) AS plots
                FROM "plots"
                WHERE status = 'owned' AND owner_empire_id IS NOT NULL
                GROUP BY owner_empire_id
                HAVING COUNT(*) > ${plots}
              ) AS bigger`
          )[0]?.rank ?? BigInt(1),
        );

  return {
    id: empire.id,
    name: empire.name,
    slug: empire.slug,
    description: empire.description,
    avatarUrl: empire.avatarUrl,
    xUsername: empire.xUsername,
    websiteUrl: empire.websiteUrl,
    createdAt: empire.createdAt.toISOString(),
    plots,
    pixels: plots * PIXELS_PER_PLOT,
    rank,
    territories: empire.plots.map((plot) => ({
      id: plot.id,
      gridX: plot.gridX,
      gridY: plot.gridY,
      ownedAt: plot.ownedAt?.toISOString() ?? null,
    })),
  };
};

export const statusFromCode = (code: number): string => CODE_STATUS[code] ?? PLOT_STATUS.unreleased;
