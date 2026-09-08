import { prisma, toNumber } from "@/lib/db";
import { badRequest, forbidden, notFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { PAYMENT_STATUS } from "@/lib/constants";
import type { PaymentGateway } from "@/server/payments/gateway";
import { razorpayGateway } from "@/server/payments/razorpay";
import { finalizePurchase, type FinalizeResult } from "./finalize";
import { mapProviderStatus, recordPaymentAttempt } from "./payments";

export interface VerifyInput {
  userId: string;
  purchaseId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Browser callback handler (§14).
 *
 * The signature proves the checkout handoff was not tampered with, but a
 * browser callback on its own is NEVER enough to grant ownership — so the
 * payment is also fetched back from the provider and its amount, currency,
 * order and status are checked against the purchase before anything is
 * finalized. Ownership itself is still created only by finalizePurchase().
 */
export const verifyAndFinalize = async (
  input: VerifyInput,
  gateway: PaymentGateway = razorpayGateway,
): Promise<FinalizeResult> => {
  const purchase = await prisma.purchase.findUnique({
    where: { id: input.purchaseId },
    include: { payments: { where: { providerOrderId: { not: null } }, take: 5 } },
  });

  if (!purchase) throw notFound("Reservation not found");
  if (purchase.userId !== input.userId) throw forbidden("This reservation is not yours");

  const knownOrderIds = new Set(
    purchase.payments.map((payment) => payment.providerOrderId).filter(Boolean) as string[],
  );
  if (!knownOrderIds.has(input.razorpayOrderId)) {
    logger.warn("verify.order_mismatch", {
      purchaseId: purchase.id,
      providerOrderId: input.razorpayOrderId,
    });
    throw badRequest("order_mismatch", "That payment does not belong to this reservation");
  }

  const signatureOk = gateway.verifyCheckoutSignature({
    orderId: input.razorpayOrderId,
    paymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  });
  if (!signatureOk) {
    logger.warn("verify.bad_signature", {
      purchaseId: purchase.id,
      providerOrderId: input.razorpayOrderId,
      providerPaymentId: input.razorpayPaymentId,
    });
    throw badRequest("invalid_signature", "We could not verify that payment");
  }

  // Authoritative state comes from the provider, not from the browser.
  const providerPayment = await gateway.fetchPayment(input.razorpayPaymentId);

  if (providerPayment.orderId !== input.razorpayOrderId) {
    throw badRequest("order_mismatch", "That payment belongs to a different order");
  }

  const expectedAmount = toNumber(purchase.amountMinor);
  if (providerPayment.amountMinor !== expectedAmount) {
    logger.warn("verify.amount_mismatch", {
      purchaseId: purchase.id,
      providerPaymentId: providerPayment.id,
      expectedMinor: expectedAmount,
      receivedMinor: providerPayment.amountMinor,
    });
    throw badRequest("amount_mismatch", "That payment does not match the reservation amount");
  }
  if (providerPayment.currency !== purchase.currency) {
    throw badRequest("currency_mismatch", "That payment is in the wrong currency");
  }

  const status = mapProviderStatus(providerPayment.status);
  const payment = await recordPaymentAttempt({
    purchaseId: purchase.id,
    provider: gateway.provider,
    providerOrderId: providerPayment.orderId,
    providerPaymentId: providerPayment.id,
    amountMinor: providerPayment.amountMinor,
    currency: providerPayment.currency,
    status,
    payload: { source: "verify", providerStatus: providerPayment.status, method: providerPayment.method ?? null },
  });

  logger.info("verify.payment_recorded", {
    purchaseId: purchase.id,
    paymentId: payment.id,
    providerPaymentId: providerPayment.id,
    status,
  });

  if (status !== PAYMENT_STATUS.paid) {
    // Authorized-not-captured, or a failure. The webhook will finalize it if
    // and when the provider captures.
    return { outcome: "ignored", reason: `payment_${status}` };
  }

  return finalizePurchase(purchase.id, payment.id);
};
