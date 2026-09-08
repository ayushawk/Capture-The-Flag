import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { PURCHASE_STATUS } from "@/lib/constants";
import { limitSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { adminPurchases } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.admin.purchases", async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const limit = limitSchema(50, 200).parse(params.get("limit") ?? undefined);
    const requested = params.get("status") ?? undefined;
    const valid = Object.values(PURCHASE_STATUS) as string[];
    return json({
      purchases: await adminPurchases({
        status: requested && valid.includes(requested) ? requested : undefined,
        limit,
        cursor: params.get("cursor") ?? undefined,
      }),
    });
  });
