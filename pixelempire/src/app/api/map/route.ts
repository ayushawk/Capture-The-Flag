import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { mapQuerySchema } from "@/lib/validation";
import { getMapRegion } from "@/server/services/read";

export const dynamic = "force-dynamic";

/** GET /api/map?minX=&minY=&maxX=&maxY= — viewport-aware public map read. */
export const GET = async (request: NextRequest) =>
  handle("api.map", async () => {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const bounds = mapQuerySchema.parse(params);
    const region = await getMapRegion(bounds);
    return json(region, {
      headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=30" },
    });
  });
