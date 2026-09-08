import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, handle, json } from "@/lib/http";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { verifyPaymentSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/guards";
import { verifyAndFinalize } from "@/server/services/verify-payment";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/verify — browser callback after Razorpay checkout (§14).
 *
 * This is a *hint* that a payment happened, never proof of it. The handler
 * re-checks the signature, re-fetches the payment from the provider, and
 * finalizes through the same finalizePurchase() the webhook uses.
 */
export const POST = async (request: NextRequest) =>
  handle("api.payments.verify", async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit("verify", `${user.id}:${clientIp(request)}`, RATE_LIMITS.verifyPayment);

    const input = verifyPaymentSchema.parse(await request.json());
    const result = await verifyAndFinalize({ userId: user.id, ...input });

    if (result.outcome === "completed") {
      return json({
        status: "completed",
        purchaseId: result.purchaseId,
        plotId: result.plotId,
        gridX: result.gridX,
        gridY: result.gridY,
        empireSlug: result.empireSlug,
      });
    }

    if (result.outcome === "refund_required") {
      // The money is real; the land is not available. Never show this as a
      // payment failure (§42).
      return json(
        {
          status: "refund_pending",
          reason: result.reason,
          message:
            "Your payment went through, but this territory was claimed first. We are arranging your refund.",
        },
        { status: 409 },
      );
    }

    return json({
      status: "processing",
      reason: result.reason,
      message: "Your payment was received. We're confirming your territory ownership.",
    });
  });
