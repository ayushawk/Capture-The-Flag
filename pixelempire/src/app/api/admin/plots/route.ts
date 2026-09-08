import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { PLOT_STATUSES } from "@/lib/constants";
import { limitSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { adminPlots } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.admin.plots", async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const limit = limitSchema(100, 500).parse(params.get("limit") ?? undefined);
    const requested = params.get("status") ?? undefined;
    const status = requested && (PLOT_STATUSES as string[]).includes(requested) ? requested : undefined;
    return json({
      plots: await adminPlots({ status, limit, cursor: params.get("cursor") ?? undefined }),
    });
  });
