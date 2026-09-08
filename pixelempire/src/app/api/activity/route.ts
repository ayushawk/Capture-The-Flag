import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { limitSchema } from "@/lib/validation";
import { getActivity } from "@/server/services/read";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.activity", async () => {
    const limit = limitSchema(20, 100).parse(request.nextUrl.searchParams.get("limit") ?? undefined);
    return json(
      { events: await getActivity(limit) },
      { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" } },
    );
  });
