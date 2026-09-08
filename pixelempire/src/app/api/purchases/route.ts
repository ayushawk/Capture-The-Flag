import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handle, json } from "@/lib/http";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { createPurchaseSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/guards";
import { GatewayError } from "@/server/payments/gateway";
import { createPurchase } from "@/server/services/purchases";

export const dynamic = "force-dynamic";

/**
 * POST /api/purchases — reserve one plot (§12, §23).
 *
 * The body carries the plot id and nothing else. Price, currency, pricing rule,
 * user, empire and lock duration are all decided server-side; anything the
 * client sent about them would be ignored.
 */
export const POST = async (request: NextRequest) =>
  handle("api.purchases.create", async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit("purchase", user.id, RATE_LIMITS.createPurchase);

    const { plotId } = createPurchaseSchema.parse(await request.json());

    try {
      const result = await createPurchase(user.id, plotId);
      return json(result, { status: result.reused ? 200 : 201 });
    } catch (error) {
      if (error instanceof GatewayError) {
        throw new ApiError(502, "provider_unavailable", error.message);
      }
      throw error;
    }
  });
