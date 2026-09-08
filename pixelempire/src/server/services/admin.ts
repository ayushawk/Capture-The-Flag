import { prisma, toNumber } from "@/lib/db";
import {
  PAYMENT_STATUS,
  PLOT_STATUS,
  PLOT_TIER,
  PURCHASE_STATUS,
} from "@/lib/constants";
import { conflict, notFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { lockActivePlotLock, lockPlotRow } from "./row-locks";

/** Operational overview for the admin dashboard (§24). */
export const adminStats = async () => {
  const [
    plotsByStatus,
    purchasesByStatus,
    paymentsByStatus,
    users,
    empires,
    activeLocks,
    openExceptions,
    unprocessedWebhooks,
    revenue,
  ] = await Promise.all([
    prisma.plot.groupBy({ by: ["status"], _count: true }),
    prisma.purchase.groupBy({ by: ["status"], _count: true }),
    prisma.payment.groupBy({ by: ["status"], _count: true }),
    prisma.user.count(),
    prisma.empire.count(),
    prisma.plotLock.count({ where: { releasedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.paymentException.count({ where: { resolvedAt: null } }),
    prisma.webhookEvent.count({ where: { processedAt: null } }),
    prisma.purchase.aggregate({
      where: { status: PURCHASE_STATUS.completed },
      _sum: { amountMinor: true },
      _count: true,
    }),
  ]);

  const tally = <T extends { status: string; _count: number }>(rows: T[]) =>
    Object.fromEntries(rows.map((row) => [row.status, row._count]));

  return {
    plots: tally(plotsByStatus),
    purchases: tally(purchasesByStatus),
    payments: tally(paymentsByStatus),
    users,
    empires,
    activeLocks,
    openExceptions,
    unprocessedWebhooks,
    completedPurchases: revenue._count,
    grossMinor: toNumber(revenue._sum.amountMinor ?? BigInt(0)),
  };
};

export const adminUsers = async (limit: number, cursor?: string) => {
  const rows = await prisma.user.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      isAdmin: true,
      createdAt: true,
      empire: { select: { id: true, name: true, slug: true, _count: { select: { plots: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt.toISOString(),
    empire: row.empire
      ? { id: row.empire.id, name: row.empire.name, slug: row.empire.slug, plots: row.empire._count.plots }
      : null,
  }));
};

export const adminPlots = async (filter: { status?: string; limit: number; cursor?: string }) => {
  const rows = await prisma.plot.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    take: filter.limit,
    ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    orderBy: [{ gridY: "asc" }, { gridX: "asc" }],
    select: {
      id: true,
      gridX: true,
      gridY: true,
      status: true,
      tier: true,
      ownedAt: true,
      ownerEmpire: { select: { id: true, name: true, slug: true } },
      locks: {
        where: { releasedAt: null },
        select: { id: true, expiresAt: true, purchaseId: true, userId: true },
        take: 1,
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    gridX: row.gridX,
    gridY: row.gridY,
    status: row.status,
    tier: row.tier,
    ownedAt: row.ownedAt?.toISOString() ?? null,
    empire: row.ownerEmpire,
    activeLock: row.locks[0]
      ? {
          id: row.locks[0].id,
          purchaseId: row.locks[0].purchaseId,
          userId: row.locks[0].userId,
          expiresAt: row.locks[0].expiresAt.toISOString(),
          expired: row.locks[0].expiresAt.getTime() <= Date.now(),
        }
      : null,
  }));
};

export const adminPurchases = async (filter: { status?: string; limit: number; cursor?: string }) => {
  const rows = await prisma.purchase.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    take: filter.limit,
    ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      expiresAt: true,
      completedAt: true,
      user: { select: { id: true, email: true } },
      plot: { select: { id: true, gridX: true, gridY: true, status: true } },
      payments: { select: { id: true, status: true, providerPaymentId: true }, orderBy: { createdAt: "asc" } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amountMinor: toNumber(row.amountMinor),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    user: row.user,
    plot: row.plot,
    payments: row.payments,
  }));
};

export const adminPayments = async (filter: { status?: string; limit: number; cursor?: string }) => {
  const rows = await prisma.payment.findMany({
    where: filter.status ? { status: filter.status } : undefined,
    take: filter.limit,
    ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      purchaseId: true,
      provider: true,
      providerOrderId: true,
      providerPaymentId: true,
      amountMinor: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  });

  // provider_payload is intentionally not returned: it is provider data kept
  // for reconciliation, not something to fan out through an API.
  return rows.map((row) => ({ ...row, amountMinor: toNumber(row.amountMinor), createdAt: row.createdAt.toISOString() }));
};

export const adminExceptions = async (limit: number, includeResolved: boolean) => {
  const rows = await prisma.paymentException.findMany({
    where: includeResolved ? undefined : { resolvedAt: null },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    detail: row.detail,
    purchaseId: row.purchaseId,
    paymentId: row.paymentId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
};

export const resolveException = async (id: string) => {
  const updated = await prisma.paymentException.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  if (updated.count === 0) throw notFound("No open exception with that id");
  logger.info("admin.exception_resolved", { exceptionId: id });
};

/**
 * Takes a plot off sale.
 *
 * Only ever applies to land nobody holds: an owned plot cannot be disabled
 * (that would break the ownership invariant), and a plot with a live
 * reservation is left alone until the reservation resolves.
 */
export const disablePlot = async (plotId: string, adminId: string) =>
  prisma.$transaction(async (tx) => {
    const plot = await lockPlotRow(tx, plotId);
    if (!plot) throw notFound("That plot does not exist");
    if (plot.status === PLOT_STATUS.owned) {
      throw conflict("plot_owned", "Owned territory cannot be disabled");
    }
    if (plot.status === PLOT_STATUS.disabled) return { status: PLOT_STATUS.disabled };

    const activeLock = await lockActivePlotLock(tx, plot.id);
    if (activeLock && activeLock.expires_at.getTime() > Date.now()) {
      throw conflict("plot_locked", "This plot has a live reservation; try again once it lapses");
    }

    await tx.$executeRaw`
      UPDATE "plots" SET status = ${PLOT_STATUS.disabled}, updated_at = NOW()
      WHERE id = ${plot.id}::uuid AND owner_user_id IS NULL`;

    logger.warn("admin.plot_disabled", { plotId, adminId });
    return { status: PLOT_STATUS.disabled };
  });

/** Puts a disabled plot back on the map, at the release state its tier implies. */
export const enablePlot = async (plotId: string, adminId: string) =>
  prisma.$transaction(async (tx) => {
    const plot = await lockPlotRow(tx, plotId);
    if (!plot) throw notFound("That plot does not exist");
    if (plot.status !== PLOT_STATUS.disabled) {
      throw conflict("plot_not_disabled", "That plot is not disabled");
    }

    const status = plot.tier === PLOT_TIER.founding ? PLOT_STATUS.available : PLOT_STATUS.unreleased;
    await tx.$executeRaw`
      UPDATE "plots" SET status = ${status}, updated_at = NOW()
      WHERE id = ${plot.id}::uuid AND status = ${PLOT_STATUS.disabled}`;

    logger.warn("admin.plot_enabled", { plotId, adminId, status });
    return { status };
  });

export const listPricingRules = async () => {
  const rules = await prisma.pricingRule.findMany({ orderBy: { createdAt: "desc" } });
  const usage = await prisma.purchase.groupBy({
    by: ["pricingRuleId"],
    _count: true,
    where: { status: { in: [PURCHASE_STATUS.pending, PURCHASE_STATUS.completed] } },
  });
  const used = new Map(usage.map((row) => [row.pricingRuleId, row._count]));

  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    tier: rule.tier,
    priceMinor: toNumber(rule.priceMinor),
    currency: rule.currency,
    inventoryLimit: rule.inventoryLimit,
    isActive: rule.isActive,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    claimed: used.get(rule.id) ?? 0,
    createdAt: rule.createdAt.toISOString(),
  }));
};

export interface PricingRuleInput {
  name: string;
  tier: string;
  priceMinor: number;
  currency: string;
  inventoryLimit: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export const createPricingRule = async (input: PricingRuleInput, adminId: string) => {
  const rule = await prisma.pricingRule.create({
    data: {
      name: input.name,
      tier: input.tier,
      priceMinor: BigInt(input.priceMinor),
      currency: input.currency,
      inventoryLimit: input.inventoryLimit,
      isActive: input.isActive,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
  });
  logger.warn("admin.pricing_rule_created", { ruleId: rule.id, adminId });
  return rule.id;
};

/**
 * Pricing rules are mutable going forward only. Historical purchases carry
 * their own copy of the amount (§8), so nothing here can rewrite what someone
 * has already paid.
 */
export const updatePricingRule = async (
  id: string,
  input: Partial<Pick<PricingRuleInput, "priceMinor" | "inventoryLimit" | "isActive" | "endsAt" | "name">>,
  adminId: string,
) => {
  const existing = await prisma.pricingRule.findUnique({ where: { id } });
  if (!existing) throw notFound("No pricing rule with that id");

  await prisma.pricingRule.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priceMinor !== undefined ? { priceMinor: BigInt(input.priceMinor) } : {}),
      ...(input.inventoryLimit !== undefined ? { inventoryLimit: input.inventoryLimit } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
    },
  });
  logger.warn("admin.pricing_rule_updated", { ruleId: id, adminId, fields: Object.keys(input) });
};

export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS);
