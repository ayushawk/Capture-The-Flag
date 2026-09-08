import { prisma, toNumber } from "@/lib/db";
import {
  ACQUISITION_TYPE,
  ACTIVITY_EVENT,
  PAYMENT_STATUS,
  PLOT_STATUS,
  PURCHASE_STATUS,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import { primaryEmpireFor } from "./empires";
import { lockPaymentRow, lockPlotRow, lockPurchaseRow } from "./row-locks";

export type FinalizeResult =
  | {
      outcome: "completed";
      purchaseId: string;
      plotId: string;
      gridX: number;
      gridY: number;
      empireId: string;
      empireSlug: string;
      /** False when this call found the work already done (duplicate delivery). */
      firstTime: boolean;
    }
  | { outcome: "refund_required"; reason: string; purchaseId: string; paymentId: string }
  | { outcome: "ignored"; reason: string };

/**
 * The ONLY operation in the system that creates ownership (§16, §37).
 *
 * Both `POST /api/payments/verify` and `POST /api/webhooks/razorpay` end here,
 * so there is exactly one implementation of "who owns this plot" to reason
 * about. Everything happens inside one transaction with the purchase, payment
 * and plot rows held `FOR UPDATE`, which makes the operation idempotent under
 * duplicate webhooks, a callback racing a webhook, and simultaneous retries.
 *
 * Two rules are absolute:
 *   - ownership is never granted merely because a payment says `paid`; it
 *     requires this transaction to succeed;
 *   - an existing owner is never overwritten. A paid transaction that cannot
 *     become ownership becomes a refund exception instead.
 */
export const finalizePurchase = async (
  purchaseId: string,
  paymentId: string,
): Promise<FinalizeResult> => {
  const result = await prisma.$transaction(
    async (tx): Promise<FinalizeResult> => {
      // 1. Purchase.
      const purchase = await lockPurchaseRow(tx, purchaseId);
      if (!purchase) return { outcome: "ignored", reason: "purchase_not_found" };

      // 2. Already finalized: return the existing successful result unchanged.
      if (purchase.status === PURCHASE_STATUS.completed) {
        const plot = await tx.plot.findUnique({
          where: { id: purchase.plot_id },
          include: { ownerEmpire: { select: { id: true, slug: true } } },
        });

        // A second payment succeeding against a finished purchase must not
        // touch ownership — it is money to give back (§10).
        const finalizing = await tx.payment.findFirst({
          where: { purchaseId: purchase.id, status: PAYMENT_STATUS.paid },
          orderBy: { updatedAt: "asc" },
          select: { id: true },
        });
        if (finalizing && finalizing.id !== paymentId) {
          await tx.paymentException.create({
            data: {
              purchaseId: purchase.id,
              paymentId,
              reason: "extra_payment_on_completed_purchase",
              detail: { finalizedByPaymentId: finalizing.id },
            },
          });
          logger.warn("finalize.extra_payment", { purchaseId, paymentId });
          return { outcome: "refund_required", reason: "purchase_already_paid", purchaseId, paymentId };
        }

        if (!plot?.ownerEmpire) return { outcome: "ignored", reason: "completed_without_owner" };
        return {
          outcome: "completed",
          purchaseId: purchase.id,
          plotId: plot.id,
          gridX: plot.gridX,
          gridY: plot.gridY,
          empireId: plot.ownerEmpire.id,
          empireSlug: plot.ownerEmpire.slug,
          firstTime: false,
        };
      }

      // A reservation that was explicitly cancelled or already refunded must
      // not be revived by a late success.
      if (
        purchase.status !== PURCHASE_STATUS.pending &&
        purchase.status !== PURCHASE_STATUS.expired
      ) {
        await tx.paymentException.create({
          data: {
            purchaseId: purchase.id,
            paymentId,
            reason: "payment_for_inactive_purchase",
            detail: { purchaseStatus: purchase.status },
          },
        });
        return {
          outcome: "refund_required",
          reason: `purchase_${purchase.status}`,
          purchaseId,
          paymentId,
        };
      }

      // 3. Payment.
      const payment = await lockPaymentRow(tx, paymentId);
      if (!payment) return { outcome: "ignored", reason: "payment_not_found" };

      // 4. Authenticity and association. Nothing here trusts the caller.
      if (payment.purchase_id !== purchase.id) {
        logger.warn("finalize.payment_purchase_mismatch", { purchaseId, paymentId });
        return { outcome: "ignored", reason: "payment_purchase_mismatch" };
      }
      if (payment.status !== PAYMENT_STATUS.paid) {
        return { outcome: "ignored", reason: `payment_not_paid:${payment.status}` };
      }
      if (payment.amount_minor !== purchase.amount_minor) {
        await tx.paymentException.create({
          data: {
            purchaseId: purchase.id,
            paymentId,
            reason: "amount_mismatch",
            detail: {
              expectedMinor: toNumber(purchase.amount_minor),
              receivedMinor: toNumber(payment.amount_minor),
            },
          },
        });
        return { outcome: "refund_required", reason: "amount_mismatch", purchaseId, paymentId };
      }
      if (payment.currency !== purchase.currency) {
        await tx.paymentException.create({
          data: {
            purchaseId: purchase.id,
            paymentId,
            reason: "currency_mismatch",
            detail: { expected: purchase.currency, received: payment.currency },
          },
        });
        return { outcome: "refund_required", reason: "currency_mismatch", purchaseId, paymentId };
      }

      // 5. Plot.
      const plot = await lockPlotRow(tx, purchase.plot_id);
      if (!plot) return { outcome: "ignored", reason: "plot_not_found" };

      // 6-8. Current ownership is the final safety invariant (§17).
      if (plot.owner_user_id !== null) {
        if (plot.owner_user_id === purchase.user_id) {
          // Same buyer already owns it through another route. Close the
          // purchase out rather than granting a second time.
          await tx.$executeRaw`
            UPDATE "purchases" SET status = ${PURCHASE_STATUS.completed}, completed_at = NOW()
            WHERE id = ${purchase.id}::uuid AND status <> ${PURCHASE_STATUS.completed}`;
          const empire = await tx.empire.findUnique({
            where: { id: plot.owner_empire_id! },
            select: { id: true, slug: true },
          });
          return {
            outcome: "completed",
            purchaseId: purchase.id,
            plotId: plot.id,
            gridX: plot.grid_x,
            gridY: plot.grid_y,
            empireId: empire?.id ?? plot.owner_empire_id!,
            empireSlug: empire?.slug ?? "",
            firstTime: false,
          };
        }

        await tx.paymentException.create({
          data: {
            purchaseId: purchase.id,
            paymentId,
            reason: "plot_owned_by_another_user",
            detail: {
              plotId: plot.id,
              gridX: plot.grid_x,
              gridY: plot.grid_y,
              ownedAt: plot.owned_at?.toISOString() ?? null,
            },
          },
        });
        logger.warn("finalize.plot_already_owned", {
          purchaseId,
          paymentId,
          plotId: plot.id,
        });
        return { outcome: "refund_required", reason: "plot_already_owned", purchaseId, paymentId };
      }

      // Unowned, but not in a state that may be sold (an admin disabled it, or
      // it was pulled back from release). Money in, no land to give.
      if (plot.status !== PLOT_STATUS.available && plot.status !== PLOT_STATUS.locked) {
        await tx.paymentException.create({
          data: {
            purchaseId: purchase.id,
            paymentId,
            reason: "plot_not_sellable",
            detail: { plotStatus: plot.status },
          },
        });
        return { outcome: "refund_required", reason: "plot_not_sellable", purchaseId, paymentId };
      }

      // 7. Grant ownership.
      const empire = await primaryEmpireFor(tx, purchase.user_id);
      const now = new Date();

      await tx.ownershipHistory.create({
        data: {
          plotId: plot.id,
          ownerUserId: purchase.user_id,
          ownerEmpireId: empire.id,
          acquisitionType: ACQUISITION_TYPE.purchase,
          purchaseId: purchase.id,
          startedAt: now,
        },
      });

      await tx.$executeRaw`
        UPDATE "plots"
        SET status = ${PLOT_STATUS.owned},
            owner_user_id = ${purchase.user_id}::uuid,
            owner_empire_id = ${empire.id}::uuid,
            owned_at = ${now},
            updated_at = NOW()
        WHERE id = ${plot.id}::uuid AND owner_user_id IS NULL`;

      await tx.$executeRaw`
        UPDATE "purchases" SET status = ${PURCHASE_STATUS.completed}, completed_at = ${now}
        WHERE id = ${purchase.id}::uuid`;

      await tx.$executeRaw`
        UPDATE "payments" SET status = ${PAYMENT_STATUS.paid}, updated_at = NOW()
        WHERE id = ${payment.id}::uuid`;

      // Ownership supersedes every reservation on this plot, including a
      // competing one that was still counting down.
      await tx.$executeRaw`
        UPDATE "plot_locks" SET released_at = ${now}
        WHERE plot_id = ${plot.id}::uuid AND released_at IS NULL`;

      await tx.activityEvent.create({
        data: {
          eventType: ACTIVITY_EVENT.territoryClaimed,
          userId: purchase.user_id,
          empireId: empire.id,
          plotId: plot.id,
          // Public feed data only — never payment details (§21).
          metadata: { empireName: empire.name, gridX: plot.grid_x, gridY: plot.grid_y },
        },
      });

      logger.info("finalize.ownership_granted", {
        purchaseId: purchase.id,
        paymentId: payment.id,
        plotId: plot.id,
        userId: purchase.user_id,
      });

      return {
        outcome: "completed",
        purchaseId: purchase.id,
        plotId: plot.id,
        gridX: plot.grid_x,
        gridY: plot.grid_y,
        empireId: empire.id,
        empireSlug: empire.slug,
        firstTime: true,
      };
    },
    { timeout: 20_000, maxWait: 10_000, isolationLevel: "ReadCommitted" },
  );

  if (result.outcome === "refund_required") {
    logger.warn("finalize.refund_required", {
      purchaseId: result.purchaseId,
      paymentId: result.paymentId,
      reason: result.reason,
    });
  } else if (result.outcome === "ignored") {
    logger.info("finalize.ignored", { purchaseId, paymentId, reason: result.reason });
  }

  return result;
};
