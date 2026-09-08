import { prisma } from "@/lib/db";
import { PLOT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { lockPlotRow, trySelectPurchaseForUpdate } from "./row-locks";

export interface SweepResult {
  scanned: number;
  locksReleased: number;
  purchasesExpired: number;
  plotsReleased: number;
  skipped: number;
}

/**
 * Lock expiration sweeper (§18). Runs about once a minute.
 *
 * Safe to run repeatedly and safe to run concurrently with itself: every step
 * is a conditional update, and a reservation another transaction is already
 * working on is skipped rather than fought over.
 *
 * It never releases ownership and never moves a plot from `owned` back to
 * `available` — the only plots it frees are ones that are still `locked` and
 * still have no owner.
 */
export const expireDueLocks = async (batchSize = 500): Promise<SweepResult> => {
  const now = new Date();

  // Read-only scan. Rows are re-checked under lock before anything changes.
  const due = await prisma.plotLock.findMany({
    where: { releasedAt: null, expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: batchSize,
    select: { id: true, plotId: true, purchaseId: true },
  });

  const result: SweepResult = {
    scanned: due.length,
    locksReleased: 0,
    purchasesExpired: 0,
    plotsReleased: 0,
    skipped: 0,
  };

  for (const candidate of due) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          // Same row order as finalizePurchase: purchase, then plot, then the
          // lock itself. Skipping a contended purchase keeps the sweeper out of
          // the way of a payment landing at the same moment.
          const purchase = await trySelectPurchaseForUpdate(tx, candidate.purchaseId);
          if (!purchase) return { skipped: true as const };

          const plot = await lockPlotRow(tx, candidate.plotId);

          const lockRows = await tx.$queryRaw<{ id: string; expires_at: Date }[]>`
            SELECT id, expires_at FROM "plot_locks"
            WHERE id = ${candidate.id}::uuid AND released_at IS NULL
            FOR UPDATE`;
          const lock = lockRows[0];
          if (!lock) return { skipped: false as const, released: false };
          if (lock.expires_at.getTime() > Date.now()) {
            // Extended or re-read after the scan: not due after all.
            return { skipped: false as const, released: false };
          }

          let purchaseExpired = false;
          if (purchase.status === PURCHASE_STATUS.pending) {
            await tx.$executeRaw`
              UPDATE "purchases" SET status = ${PURCHASE_STATUS.expired}
              WHERE id = ${purchase.id}::uuid AND status = ${PURCHASE_STATUS.pending}`;
            purchaseExpired = true;
          }

          let plotReleased = false;
          if (plot && plot.status === PLOT_STATUS.locked && plot.owner_user_id === null) {
            const updated = await tx.$executeRaw`
              UPDATE "plots" SET status = ${PLOT_STATUS.available}, updated_at = NOW()
              WHERE id = ${plot.id}::uuid
                AND status = ${PLOT_STATUS.locked}
                AND owner_user_id IS NULL`;
            plotReleased = updated > 0;
          }

          await tx.$executeRaw`
            UPDATE "plot_locks" SET released_at = NOW()
            WHERE id = ${lock.id}::uuid AND released_at IS NULL`;

          return { skipped: false as const, released: true, purchaseExpired, plotReleased };
        },
        { timeout: 10_000, maxWait: 5_000 },
      );

      if (outcome.skipped) {
        result.skipped += 1;
        continue;
      }
      if (outcome.released) {
        result.locksReleased += 1;
        if (outcome.purchaseExpired) result.purchasesExpired += 1;
        if (outcome.plotReleased) result.plotsReleased += 1;
        logger.info("lock.expired", {
          purchaseId: candidate.purchaseId,
          plotId: candidate.plotId,
          plotReleased: outcome.plotReleased,
        });
      }
    } catch (error) {
      // One bad reservation must not stop the sweep; it is retried next run.
      result.skipped += 1;
      logger.error("lock.expire_failed", {
        purchaseId: candidate.purchaseId,
        plotId: candidate.plotId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.scanned > 0) logger.info("lock.sweep_complete", { ...result });
  return result;
};
