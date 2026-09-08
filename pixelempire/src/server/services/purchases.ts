import { prisma, toNumber } from "@/lib/db";
import {
  CHECKOUT_LOCK_MINUTES,
  PAYMENT_STATUS,
  PLOT_STATUS,
  PURCHASE_STATUS,
} from "@/lib/constants";
import { conflict, notFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { GatewayError, type PaymentGateway } from "@/server/payments/gateway";
import { razorpayGateway } from "@/server/payments/razorpay";
import { activePricingRule } from "./pricing";
import {
  lockActivePlotLock,
  lockPlotRow,
  releaseExpiredLock,
} from "./row-locks";

/**
 * Anti-squatting guard: a single account may hold this many unpaid
 * reservations at once. Founding inventory is only 1,000 plots, so an
 * unbounded reservation loop would be enough to take the map off sale.
 * Not a spec requirement — it implements §36's "rate limiting on
 * purchase/payment endpoints" at the inventory level.
 */
const MAX_ACTIVE_RESERVATIONS = 5;

export interface CreatePurchaseResult {
  purchaseId: string;
  plotId: string;
  gridX: number;
  gridY: number;
  amountMinor: number;
  currency: string;
  status: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  expiresAt: string;
  /** True when an existing live reservation was handed back rather than a new
   *  one created — the §10 retry path. */
  reused: boolean;
}

interface Reservation {
  purchaseId: string;
  plotId: string;
  gridX: number;
  gridY: number;
  amountMinor: number;
  currency: string;
  expiresAt: Date;
  reused: boolean;
}

/**
 * Reserves a plot for one user (§12).
 *
 * The database transaction below is the whole of the concurrency story: the
 * plot row is taken `FOR UPDATE` before anything is read from it, so two
 * simultaneous claims serialise and the loser sees `locked`. The provider order
 * is deliberately created *after* the transaction commits — an external HTTP
 * call cannot be part of an atomic database unit (§13) — and a failure there is
 * compensated rather than left dangling.
 */
export const createPurchase = async (
  userId: string,
  plotId: string,
  gateway: PaymentGateway = razorpayGateway,
): Promise<CreatePurchaseResult> => {
  const reservation = await reservePlot(userId, plotId);

  // A live reservation may already have an order: reuse it so the user keeps
  // one order across payment retries (§10).
  const existingOrder = reservation.reused
    ? await prisma.payment.findFirst({
        where: { purchaseId: reservation.purchaseId, providerOrderId: { not: null } },
        orderBy: { createdAt: "asc" },
      })
    : null;

  if (existingOrder?.providerOrderId) {
    logger.info("purchase.reservation_reused", {
      purchaseId: reservation.purchaseId,
      plotId: reservation.plotId,
      userId,
      providerOrderId: existingOrder.providerOrderId,
    });
    return shape(reservation, existingOrder.providerOrderId);
  }

  try {
    const order = await gateway.createOrder({
      amountMinor: reservation.amountMinor,
      currency: reservation.currency,
      receipt: reservation.purchaseId,
      notes: {
        purchaseId: reservation.purchaseId,
        plotId: reservation.plotId,
        coordinates: `${reservation.gridX},${reservation.gridY}`,
      },
    });

    // The order exists but nobody has attempted payment yet: `created`.
    await prisma.payment.create({
      data: {
        purchaseId: reservation.purchaseId,
        provider: gateway.provider,
        providerOrderId: order.id,
        amountMinor: BigInt(reservation.amountMinor),
        currency: reservation.currency,
        status: PAYMENT_STATUS.created,
      },
    });

    logger.info("purchase.order_created", {
      purchaseId: reservation.purchaseId,
      plotId: reservation.plotId,
      userId,
      providerOrderId: order.id,
    });

    return shape(reservation, order.id);
  } catch (error) {
    await compensateFailedOrder(reservation.purchaseId, reservation.plotId);
    logger.error("purchase.order_failed", {
      purchaseId: reservation.purchaseId,
      plotId: reservation.plotId,
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new GatewayError(
      "We could not start checkout with the payment provider. The plot has been released — please try again.",
    );
  }
};

const shape = (reservation: Reservation, razorpayOrderId: string): CreatePurchaseResult => ({
  purchaseId: reservation.purchaseId,
  plotId: reservation.plotId,
  gridX: reservation.gridX,
  gridY: reservation.gridY,
  amountMinor: reservation.amountMinor,
  currency: reservation.currency,
  status: PURCHASE_STATUS.pending,
  razorpayOrderId,
  razorpayKeyId: env.publicRazorpayKeyId || env.razorpayKeyId,
  expiresAt: reservation.expiresAt.toISOString(),
  reused: reservation.reused,
});

/** Steps 1-10 of §12, as one transaction. */
const reservePlot = async (userId: string, plotId: string): Promise<Reservation> =>
  prisma.$transaction(
    async (tx) => {
      const plot = await lockPlotRow(tx, plotId);
      if (!plot) throw notFound("That plot does not exist");

      const now = new Date();
      const activeLock = await lockActivePlotLock(tx, plot.id);

      if (activeLock) {
        if (activeLock.expires_at.getTime() > now.getTime()) {
          // Still live. The owner of the reservation gets it back (§10);
          // anyone else is told the plot is taken.
          const heldPurchase = await tx.purchase.findUnique({
            where: { id: activeLock.purchase_id },
            include: { plot: { select: { gridX: true, gridY: true } } },
          });

          if (
            activeLock.user_id === userId &&
            heldPurchase &&
            heldPurchase.status === PURCHASE_STATUS.pending
          ) {
            return {
              purchaseId: heldPurchase.id,
              plotId: plot.id,
              gridX: heldPurchase.plot.gridX,
              gridY: heldPurchase.plot.gridY,
              amountMinor: toNumber(heldPurchase.amountMinor),
              currency: heldPurchase.currency,
              expiresAt: heldPurchase.expiresAt,
              reused: true,
            };
          }

          throw conflict("plot_unavailable", "Someone else is claiming this plot right now");
        }

        // The window has passed. Release it here rather than waiting for the
        // sweeper, so the plot is claimable the moment it should be — unless a
        // finalization is holding the purchase, in which case this plot may be
        // about to become owned and we must not touch it.
        const released = await releaseExpiredLock(tx, activeLock, plot);
        if (!released) {
          throw conflict("plot_unavailable", "Someone else is claiming this plot right now");
        }
      }

      if (plot.status === PLOT_STATUS.owned) {
        throw conflict("plot_owned", "This territory already belongs to another empire");
      }
      if (plot.status !== PLOT_STATUS.available) {
        throw conflict("plot_unavailable", messageForStatus(plot.status));
      }

      const held = await tx.purchase.count({
        where: { userId, status: PURCHASE_STATUS.pending, expiresAt: { gt: now } },
      });
      if (held >= MAX_ACTIVE_RESERVATIONS) {
        throw conflict(
          "too_many_reservations",
          `You already have ${MAX_ACTIVE_RESERVATIONS} reservations waiting for payment. Finish or cancel one first.`,
        );
      }

      const rule = await activePricingRule(tx, plot.tier);
      const expiresAt = new Date(now.getTime() + CHECKOUT_LOCK_MINUTES * 60_000);

      const purchase = await tx.purchase.create({
        data: {
          userId,
          plotId: plot.id,
          pricingRuleId: rule.id,
          // Copied from the rule, then immutable (§8).
          amountMinor: rule.priceMinor,
          currency: rule.currency,
          status: PURCHASE_STATUS.pending,
          expiresAt,
        },
      });

      await tx.plotLock.create({
        data: {
          plotId: plot.id,
          purchaseId: purchase.id,
          userId,
          lockedAt: now,
          expiresAt,
        },
      });

      await tx.$executeRaw`
        UPDATE "plots" SET status = ${PLOT_STATUS.locked}, updated_at = NOW()
        WHERE id = ${plot.id}::uuid AND status = ${PLOT_STATUS.available}`;

      logger.info("purchase.created", {
        purchaseId: purchase.id,
        plotId: plot.id,
        userId,
        amountMinor: toNumber(purchase.amountMinor),
        currency: purchase.currency,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        purchaseId: purchase.id,
        plotId: plot.id,
        gridX: plot.grid_x,
        gridY: plot.grid_y,
        amountMinor: toNumber(purchase.amountMinor),
        currency: purchase.currency,
        expiresAt,
        reused: false,
      };
    },
    { timeout: 15_000, maxWait: 10_000 },
  );

const messageForStatus = (status: string): string => {
  switch (status) {
    case PLOT_STATUS.locked:
      return "Someone else is claiming this plot right now";
    case PLOT_STATUS.unreleased:
      return "This land has not been released yet";
    case PLOT_STATUS.disabled:
      return "This plot is not available";
    default:
      return "This plot cannot be claimed right now";
  }
};

/**
 * §13: the database committed but the provider did not. Undo the reservation so
 * no plot is ever permanently stranded in `locked`.
 *
 * Guarded on `status = pending` throughout: if a webhook somehow finalized the
 * purchase between the two steps, this is a no-op and ownership stands.
 */
export const compensateFailedOrder = async (purchaseId: string, plotId: string): Promise<void> => {
  try {
    await prisma.$transaction(async (tx) => {
      const cancelled = await tx.$executeRaw`
        UPDATE "purchases" SET status = ${PURCHASE_STATUS.cancelled}
        WHERE id = ${purchaseId}::uuid AND status = ${PURCHASE_STATUS.pending}`;
      if (cancelled === 0) return;

      await tx.$executeRaw`
        UPDATE "plot_locks" SET released_at = NOW()
        WHERE purchase_id = ${purchaseId}::uuid AND released_at IS NULL`;

      await tx.$executeRaw`
        UPDATE "plots" SET status = ${PLOT_STATUS.available}, updated_at = NOW()
        WHERE id = ${plotId}::uuid AND status = ${PLOT_STATUS.locked} AND owner_user_id IS NULL`;
    });
    logger.warn("purchase.cancelled_after_order_failure", { purchaseId, plotId });
  } catch (error) {
    // The compensation itself failed. The sweeper (§18) will still release the
    // lock when its window passes, so the plot cannot be stranded.
    logger.error("purchase.compensation_failed", {
      purchaseId,
      plotId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

/** Reservation status for the checkout screen's polling (§42). */
export const purchaseStatusFor = async (userId: string, purchaseId: string) => {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      plot: { select: { id: true, gridX: true, gridY: true, status: true, ownerUserId: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!purchase || purchase.userId !== userId) throw notFound("Reservation not found");

  const owned = purchase.plot.ownerUserId === userId;
  const paidAttempt = purchase.payments.some((payment) => payment.status === PAYMENT_STATUS.paid);

  return {
    purchaseId: purchase.id,
    status: purchase.status,
    amountMinor: toNumber(purchase.amountMinor),
    currency: purchase.currency,
    expiresAt: purchase.expiresAt.toISOString(),
    completedAt: purchase.completedAt?.toISOString() ?? null,
    plot: {
      id: purchase.plot.id,
      gridX: purchase.plot.gridX,
      gridY: purchase.plot.gridY,
      status: purchase.plot.status,
    },
    ownedByYou: owned,
    /* Payment took, ownership has not been written yet. The UI must say
       "confirming", never "failed" (§42). */
    awaitingFinalization:
      paidAttempt && purchase.status !== PURCHASE_STATUS.completed && !owned,
  };
};
