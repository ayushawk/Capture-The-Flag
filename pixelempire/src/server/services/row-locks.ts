import type { Tx } from "@/lib/db";
import { PLOT_STATUS, PURCHASE_STATUS } from "@/lib/constants";

/**
 * Explicit `SELECT ... FOR UPDATE` helpers.
 *
 * Every service that can change ownership takes these rows in the same order —
 * purchase, payment, plot — so concurrent finalizations serialise instead of
 * deadlocking.
 */

export interface PlotRow {
  id: string;
  grid_x: number;
  grid_y: number;
  status: string;
  tier: string;
  owner_user_id: string | null;
  owner_empire_id: string | null;
  owned_at: Date | null;
}

export interface PurchaseRow {
  id: string;
  user_id: string;
  plot_id: string;
  pricing_rule_id: string;
  amount_minor: bigint;
  currency: string;
  status: string;
  expires_at: Date;
  completed_at: Date | null;
}

export interface PaymentRow {
  id: string;
  purchase_id: string;
  provider: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  amount_minor: bigint;
  currency: string;
  status: string;
}

export interface PlotLockRow {
  id: string;
  plot_id: string;
  purchase_id: string;
  user_id: string;
  expires_at: Date;
  released_at: Date | null;
}

export const lockPlotRow = async (tx: Tx, plotId: string): Promise<PlotRow | null> => {
  const rows = await tx.$queryRaw<PlotRow[]>`
    SELECT id, grid_x, grid_y, status, tier, owner_user_id, owner_empire_id, owned_at
    FROM "plots" WHERE id = ${plotId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
};

export const lockPurchaseRow = async (tx: Tx, purchaseId: string): Promise<PurchaseRow | null> => {
  const rows = await tx.$queryRaw<PurchaseRow[]>`
    SELECT id, user_id, plot_id, pricing_rule_id, amount_minor, currency, status, expires_at, completed_at
    FROM "purchases" WHERE id = ${purchaseId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
};

/**
 * Non-blocking variant, for callers that already hold the plot row.
 *
 * finalizePurchase() takes rows in the order purchase -> payment -> plot, while
 * the claim path necessarily starts from the plot. Waiting for a contended
 * purchase from inside a plot lock is exactly the cycle Postgres would report
 * as a deadlock, so those callers skip instead: `null` means "another
 * transaction owns this purchase right now", which they treat as the plot being
 * momentarily unavailable rather than forcing the issue.
 */
export const trySelectPurchaseForUpdate = async (
  tx: Tx,
  purchaseId: string,
): Promise<PurchaseRow | null> => {
  const rows = await tx.$queryRaw<PurchaseRow[]>`
    SELECT id, user_id, plot_id, pricing_rule_id, amount_minor, currency, status, expires_at, completed_at
    FROM "purchases" WHERE id = ${purchaseId}::uuid FOR UPDATE SKIP LOCKED`;
  return rows[0] ?? null;
};

export const lockPaymentRow = async (tx: Tx, paymentId: string): Promise<PaymentRow | null> => {
  const rows = await tx.$queryRaw<PaymentRow[]>`
    SELECT id, purchase_id, provider, provider_order_id, provider_payment_id, amount_minor, currency, status
    FROM "payments" WHERE id = ${paymentId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
};

/** The plot's active lock, if any, taken FOR UPDATE. */
export const lockActivePlotLock = async (tx: Tx, plotId: string): Promise<PlotLockRow | null> => {
  const rows = await tx.$queryRaw<PlotLockRow[]>`
    SELECT id, plot_id, purchase_id, user_id, expires_at, released_at
    FROM "plot_locks" WHERE plot_id = ${plotId}::uuid AND released_at IS NULL
    FOR UPDATE`;
  return rows[0] ?? null;
};

/**
 * Releases a reservation whose window has passed, inside the caller's
 * transaction: purchase -> expired, lock released, plot -> available.
 *
 * Runs inline on the claim path so a plot never stays unclaimable while waiting
 * for the sweeper (§18) to come round. Ownership is never touched, and the plot
 * is only returned to `available` while it still has no owner.
 *
 * Returns false when the reservation's purchase is held by another transaction
 * — most likely a finalization landing at the same moment — in which case the
 * caller must back off rather than release land that is about to be owned.
 */
export const releaseExpiredLock = async (
  tx: Tx,
  lock: PlotLockRow,
  plot: PlotRow,
): Promise<boolean> => {
  const purchase = await trySelectPurchaseForUpdate(tx, lock.purchase_id);
  if (!purchase) return false;

  const now = new Date();

  if (purchase.status === PURCHASE_STATUS.pending) {
    await tx.$executeRaw`
      UPDATE "purchases" SET status = ${PURCHASE_STATUS.expired}
      WHERE id = ${lock.purchase_id}::uuid AND status = ${PURCHASE_STATUS.pending}`;
  }

  await tx.$executeRaw`
    UPDATE "plot_locks" SET released_at = ${now}
    WHERE id = ${lock.id}::uuid AND released_at IS NULL`;

  if (plot.status === PLOT_STATUS.locked && plot.owner_user_id === null) {
    await tx.$executeRaw`
      UPDATE "plots" SET status = ${PLOT_STATUS.available}, updated_at = NOW()
      WHERE id = ${plot.id}::uuid AND status = ${PLOT_STATUS.locked} AND owner_user_id IS NULL`;
    plot.status = PLOT_STATUS.available;
  }

  return true;
};
