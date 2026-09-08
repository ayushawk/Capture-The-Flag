import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, json } from "@/lib/http";
import { getPlotByGrid } from "@/server/services/read";

export const dynamic = "force-dynamic";

const coordSchema = z.object({
  x: z.coerce.number().int().min(0).max(99),
  y: z.coerce.number().int().min(0).max(99),
});

/** GET /api/plots?x=&y= — plot lookup by grid coordinate, for map selection. */
export const GET = async (request: NextRequest) =>
  handle("api.plot_by_grid", async () => {
    const { x, y } = coordSchema.parse({
      x: request.nextUrl.searchParams.get("x"),
      y: request.nextUrl.searchParams.get("y"),
    });
    return json(await getPlotByGrid(x, y));
  });
