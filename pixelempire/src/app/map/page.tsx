import type { Metadata } from "next";
import { z } from "zod";
import MapExperience from "@/components/MapExperience";
import { prisma } from "@/lib/db";
import { PLOT_STATUS } from "@/lib/constants";
import { getSessionUser } from "@/server/auth/session";
import { getStats } from "@/server/services/read";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The map",
  description: "Explore the world and claim your founding territory.",
};

const coord = z.coerce.number().int().min(0).max(99);

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ x?: string; y?: string }>;
}) {
  const params = await searchParams;
  const x = coord.safeParse(params.x);
  const y = coord.safeParse(params.y);
  const initial = x.success && y.success ? { x: x.data, y: y.data } : null;

  const user = await getSessionUser();
  const [stats, empire] = await Promise.all([
    getStats(),
    user ? prisma.empire.findUnique({ where: { ownerUserId: user.id } }) : null,
  ]);

  const ownedPlots = empire
    ? await prisma.plot.findMany({
        where: { ownerEmpireId: empire.id, status: PLOT_STATUS.owned },
        select: { id: true },
      })
    : [];

  return (
    <MapExperience
      signedIn={Boolean(user)}
      userEmail={user?.email ?? null}
      ownedPlotIds={ownedPlots.map((plot) => plot.id)}
      empireSlug={empire?.slug ?? null}
      initial={initial}
      stats={{
        availablePlots: stats.availablePlots,
        claimedPlots: stats.claimedPlots,
        empires: stats.empires,
      }}
    />
  );
}
