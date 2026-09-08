import { Prisma } from "@prisma/client";
import type { Payment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PAYMENT_STATUS, type PaymentStatus } from "@/lib/constants";
import { logger } from "@/lib/logger";

const UNIQUE_VIOLATION = "P2002";

/** Razorpay's payment lifecycle mapped onto our five states (§9). */
export const mapProviderStatus = (providerStatus: string): PaymentStatus => {
  switch (providerStatus) {
    case "captured":
      return PAYMENT_STATUS.paid;
    case "authorized":
      // Money is held but not captured: real, not yet final.
      return PAYMENT_STATUS.pending;
    case "refunded":
      return PAYMENT_STATUS.refunded;
    case "failed":
      return PAYMENT_STATUS.failed;
    case "created":
    default:
      return PAYMENT_STATUS.created;
  }
};

export interface RecordAttemptInput {
  purchaseId: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string;
  providerEventId?: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  payload?: Prisma.InputJsonValue;
}

/**
 * Records one provider payment attempt against a purchase (§9, §10).
 *
 * A purchase may accumulate many attempts; the first one adopts the `created`
 * row that was written alongside the provider order, and later attempts get
 * rows of their own. `(provider, provider_payment_id)` is unique, so a
 * duplicated webhook or a callback racing a webhook converges on one row
 * instead of forking into two.
 */
export const recordPaymentAttempt = async (input: RecordAttemptInput): Promise<Payment> => {
  const existing = await prisma.payment.findFirst({
    where: { provider: input.provider, providerPaymentId: input.providerPaymentId },
  });

  if (existing) {
    // Never walk a payment backwards out of a terminal state.
    const terminal: string[] = [PAYMENT_STATUS.paid, PAYMENT_STATUS.refunded];
    const status = terminal.includes(existing.status) ? existing.status : input.status;

    return prisma.payment.update({
      where: { id: existing.id },
      data: {
        status,
        providerOrderId: existing.providerOrderId ?? input.providerOrderId,
        providerEventId: input.providerEventId ?? existing.providerEventId,
        providerPayload: input.payload ?? existing.providerPayload ?? Prisma.JsonNull,
      },
    });
  }

  // Adopt the placeholder row created with the provider order, if it is free.
  const claimed = await prisma.payment.updateMany({
    where: {
      purchaseId: input.purchaseId,
      provider: input.provider,
      providerPaymentId: null,
      status: PAYMENT_STATUS.created,
    },
    data: {
      providerPaymentId: input.providerPaymentId,
      providerOrderId: input.providerOrderId,
      providerEventId: input.providerEventId ?? null,
      status: input.status,
      providerPayload: input.payload,
    },
  });

  if (claimed.count > 0) {
    const adopted = await prisma.payment.findFirst({
      where: { provider: input.provider, providerPaymentId: input.providerPaymentId },
    });
    if (adopted) return adopted;
  }

  try {
    return await prisma.payment.create({
      data: {
        purchaseId: input.purchaseId,
        provider: input.provider,
        providerOrderId: input.providerOrderId,
        providerPaymentId: input.providerPaymentId,
        providerEventId: input.providerEventId ?? null,
        amountMinor: BigInt(input.amountMinor),
        currency: input.currency,
        status: input.status,
        providerPayload: input.payload,
      },
    });
  } catch (error) {
    // Lost the race with a concurrent delivery of the same payment: the row
    // the other writer created is the answer.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      const winner = await prisma.payment.findFirst({
        where: { provider: input.provider, providerPaymentId: input.providerPaymentId },
      });
      if (winner) {
        logger.info("payment.attempt_deduplicated", {
          paymentId: winner.id,
          purchaseId: input.purchaseId,
          providerPaymentId: input.providerPaymentId,
        });
        return winner;
      }
    }
    throw error;
  }
};

/** Files a paid-but-unusable transaction for operator follow-up (§16, §24). */
export const raisePaymentException = async (
  reason: string,
  detail: Prisma.InputJsonValue,
  ids: { purchaseId?: string | null; paymentId?: string | null },
): Promise<void> => {
  await prisma.paymentException.create({
    data: {
      reason,
      detail,
      purchaseId: ids.purchaseId ?? null,
      paymentId: ids.paymentId ?? null,
    },
  });
  logger.warn("payment.exception_raised", {
    reason,
    purchaseId: ids.purchaseId ?? undefined,
    paymentId: ids.paymentId ?? undefined,
  });
};
