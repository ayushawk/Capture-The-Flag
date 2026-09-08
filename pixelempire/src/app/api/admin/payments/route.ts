import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { limitSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { PAYMENT_STATUS_VALUES, adminPayments } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.admin.payments", async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const limit = limitSchema(50, 200).parse(params.get("limit") ?? undefined);
    const requested = params.get("status") ?? undefined;
    return json({
      payments: await adminPayments({
        status: requested && (PAYMENT_STATUS_VALUES as string[]).includes(requested) ? requested : undefined,
        limit,
        cursor: params.get("cursor") ?? undefined,
      }),
    });
  });
