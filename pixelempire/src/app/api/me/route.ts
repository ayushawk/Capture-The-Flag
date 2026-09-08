import { handle, json } from "@/lib/http";
import { prisma } from "@/lib/db";
import { PIXELS_PER_PLOT, PLOT_STATUS } from "@/lib/constants";
import { requireUser } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

/** GET /api/me — the signed-in user, their empire and their holdings. */
export const GET = async () =>
  handle("api.me", async () => {
    const user = await requireUser();

    const empire = await prisma.empire.findUnique({ where: { ownerUserId: user.id } });
    const plots = empire
      ? await prisma.plot.findMany({
          where: { ownerEmpireId: empire.id, status: PLOT_STATUS.owned },
          select: { id: true, gridX: true, gridY: true, ownedAt: true },
          orderBy: [{ gridY: "asc" }, { gridX: "asc" }],
        })
      : [];

    return json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
      },
      empire: empire
        ? {
            id: empire.id,
            name: empire.name,
            slug: empire.slug,
            description: empire.description,
            xUsername: empire.xUsername,
            websiteUrl: empire.websiteUrl,
            avatarUrl: empire.avatarUrl,
          }
        : null,
      plots: plots.map((plot) => ({
        id: plot.id,
        gridX: plot.gridX,
        gridY: plot.gridY,
        ownedAt: plot.ownedAt?.toISOString() ?? null,
      })),
      pixels: plots.length * PIXELS_PER_PLOT,
    });
  });
