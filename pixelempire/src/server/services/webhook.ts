import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PAYMENT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
import { badRequest } from "@/lib/http";
import { logger } from "@/lib/logger";
import type { PaymentGateway } from "@/server/payments/gateway";
import { razorpayGateway } from "@/server/payments/razorpay";
import { finalizePurchase } from "./finalize";
import { mapProviderStatus, recordPaymentAttempt, raisePaymentException } from "./payments";

const UNIQUE_VIOLATION = "P2002";

interface RazorpayPaymentEntity {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  notes?: Record<string, string>;
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    refund?: { entity?: { id: string; payment_id: string; amount: number } };
  };
}

export interface WebhookResult {
  handled: boolean;
  reason: string;
  purchaseId?: string;
  paymentId?: string;
}

/**
 * Razorpay webhook processing (§15).
 *
 * Idempotent at three layers, because "the same webhook may arrive more than
 * once" is a certainty rather than an edge case:
 *   1. `webhook_events` is unique on (provider, event id), so a redelivery of a
 *      finished event returns early;
 *   2. `payments` is unique on (provider, provider payment id), so an attempt
 *      never forks into two rows;
 *   3. finalizePurchase() holds the purchase row and returns the existing
 *      result when the purchase is already completed.
 *
 * Ownership finalization is not reimplemented here — this endpoint and the
 * browser callback both call the same service.
 */
export const processRazorpayWebhook = async (
  rawBody: string,
  signature: string | null,
  eventId: string | null,
  gateway: PaymentGateway = razorpayGateway,
): Promise<WebhookResult> => {
  if (!signature) throw badRequest("missing_signature", "Missing webhook signature");
  if (!gateway.verifyWebhookSignature(rawBody, signature)) {
    logger.warn("webhook.bad_signature", { providerEventId: eventId ?? undefined });
    throw badRequest("invalid_signature", "Invalid webhook signature");
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    throw badRequest("invalid_payload", "Webhook body was not valid JSON");
  }

  const eventType = body.event ?? "unknown";
  // Razorpay sends the id in a header; fall back to a body-derived key so an
  // event without one still deduplicates.
  const providerEventId =
    eventId ?? `${eventType}:${body.payload?.payment?.entity?.id ?? "unknown"}`;

  const claim = await claimEvent(gateway.provider, providerEventId, eventType, body);
  if (claim === "already_processed") {
    logger.info("webhook.duplicate_ignored", { providerEventId, eventType });
    return { handled: false, reason: "duplicate_event" };
  }

  logger.info("webhook.received", { providerEventId, eventType });

  try {
    const result = await route(eventType, body, providerEventId, gateway);
    await prisma.webhookEvent.updateMany({
      where: { provider: gateway.provider, providerEventId },
      data: { processedAt: new Date(), error: null },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Leave processedAt null so a Razorpay retry gets another attempt.
    await prisma.webhookEvent.updateMany({
      where: { provider: gateway.provider, providerEventId },
      data: { error: message.slice(0, 500) },
    });
    logger.error("webhook.processing_failed", { providerEventId, eventType, message });
    throw error;
  }
};

/** Inserts the event, or reports that a completed run already handled it. */
const claimEvent = async (
  provider: string,
  providerEventId: string,
  eventType: string,
  body: RazorpayWebhookBody,
): Promise<"claimed" | "already_processed"> => {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        providerEventId,
        eventType,
        payload: body as unknown as Prisma.InputJsonValue,
      },
    });
    return "claimed";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      const existing = await prisma.webhookEvent.findUnique({
        where: { provider_providerEventId: { provider, providerEventId } },
      });
      // A previous attempt that never finished is retried; a finished one is not.
      return existing?.processedAt ? "already_processed" : "claimed";
    }
    throw error;
  }
};

const route = async (
  eventType: string,
  body: RazorpayWebhookBody,
  providerEventId: string,
  gateway: PaymentGateway,
): Promise<WebhookResult> => {
  const entity = body.payload?.payment?.entity;

  switch (eventType) {
    case "payment.captured":
    case "payment.authorized":
    case "payment.failed":
    case "order.paid":
      if (!entity) return { handled: false, reason: "no_payment_entity" };
      return handlePaymentEvent(entity, providerEventId, gateway);

    case "refund.created":
    case "refund.processed":
      return handleRefund(body, gateway);

    default:
      logger.info("webhook.event_ignored", { eventType, providerEventId });
      return { handled: false, reason: `unhandled_event:${eventType}` };
  }
};

const handlePaymentEvent = async (
  entity: RazorpayPaymentEntity,
  providerEventId: string,
  gateway: PaymentGateway,
): Promise<WebhookResult> => {
  const purchaseId = await resolvePurchaseId(entity, gateway.provider);

  if (!purchaseId) {
    await raisePaymentException(
      "webhook_payment_without_purchase",
      { providerPaymentId: entity.id, providerOrderId: entity.order_id, providerEventId },
      {},
    );
    return { handled: false, reason: "purchase_not_found" };
  }

  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return { handled: false, reason: "purchase_not_found" };

  const status = mapProviderStatus(entity.status);
  const payment = await recordPaymentAttempt({
    purchaseId: purchase.id,
    provider: gateway.provider,
    providerOrderId: entity.order_id,
    providerPaymentId: entity.id,
    providerEventId,
    amountMinor: entity.amount,
    currency: entity.currency,
    status,
    payload: { source: "webhook", providerStatus: entity.status, method: entity.method ?? null },
  });

  logger.info("webhook.payment_recorded", {
    purchaseId: purchase.id,
    paymentId: payment.id,
    providerPaymentId: entity.id,
    providerEventId,
    status,
  });

  if (status !== PAYMENT_STATUS.paid) {
    return { handled: true, reason: `payment_${status}`, purchaseId: purchase.id, paymentId: payment.id };
  }

  // §17: a payment that lands after the reservation window is not rejected out
  // of hand. finalizePurchase() inspects the plot's actual current state.
  const result = await finalizePurchase(purchase.id, payment.id);
  return {
    handled: true,
    reason: result.outcome,
    purchaseId: purchase.id,
    paymentId: payment.id,
  };
};

/** Keeps our record straight when money goes back, without touching ownership. */
const handleRefund = async (
  body: RazorpayWebhookBody,
  gateway: PaymentGateway,
): Promise<WebhookResult> => {
  const refund = body.payload?.refund?.entity;
  if (!refund) return { handled: false, reason: "no_refund_entity" };

  const payment = await prisma.payment.findFirst({
    where: { provider: gateway.provider, providerPaymentId: refund.payment_id },
  });
  if (!payment) return { handled: false, reason: "payment_not_found" };

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PAYMENT_STATUS.refunded },
  });

  // A refunded purchase is marked refunded, but ownership already granted is
  // left alone: unwinding a claim is an operator decision, not a webhook's.
  await prisma.purchase.updateMany({
    where: { id: payment.purchaseId, status: PURCHASE_STATUS.completed },
    data: { status: PURCHASE_STATUS.refunded },
  });

  logger.warn("webhook.refund_recorded", {
    paymentId: payment.id,
    purchaseId: payment.purchaseId,
    providerPaymentId: refund.payment_id,
  });

  return { handled: true, reason: "refund_recorded", purchaseId: payment.purchaseId, paymentId: payment.id };
};

/** Prefer the purchase id we stamped on the order; fall back to the order id. */
const resolvePurchaseId = async (
  entity: RazorpayPaymentEntity,
  provider: string,
): Promise<string | null> => {
  const fromNotes = entity.notes?.purchaseId;
  if (fromNotes) {
    const exists = await prisma.purchase.findUnique({
      where: { id: fromNotes },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  if (entity.order_id) {
    const payment = await prisma.payment.findFirst({
      where: { provider, providerOrderId: entity.order_id },
      select: { purchaseId: true },
    });
    if (payment) return payment.purchaseId;
  }

  return null;
};
