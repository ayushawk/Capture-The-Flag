import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { limitSchema } from "@/lib/validation";
import { getLeaderboard } from "@/server/services/read";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.leaderboard", async () => {
    const limit = limitSchema(50, 200).parse(request.nextUrl.searchParams.get("limit") ?? undefined);
    return json(
      { rows: await getLeaderboard(limit) },
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } },
    );
  });
