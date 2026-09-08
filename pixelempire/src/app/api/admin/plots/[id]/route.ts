import type { NextRequest } from "next/server";
import { assertSameOrigin, badRequest, handle, json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { disablePlot, enablePlot } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** POST /api/admin/plots/:id { action: "disable" | "enable" } */
export const POST = async (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  handle("api.admin.plot_action", async () => {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const plotId = uuidSchema.parse(id);

    const body = (await request.json()) as { action?: string };
    if (body.action === "disable") return json(await disablePlot(plotId, admin.id));
    if (body.action === "enable") return json(await enablePlot(plotId, admin.id));
    throw badRequest("unknown_action", 'action must be "disable" or "enable"');
  });
