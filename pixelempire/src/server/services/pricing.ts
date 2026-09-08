import type { PricingRule } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { PURCHASE_STATUS } from "@/lib/constants";
import { conflict } from "@/lib/http";

/**
 * Price is decided by the server, from the active pricing rule for the plot's
 * tier — never by the client (§12, §36). The chosen amount is copied onto the
 * purchase so later edits to the rule cannot rewrite history (§8).
 */
export const activePricingRule = async (tx: Tx, tier: string): Promise<PricingRule> => {
  const now = new Date();

  const rule = await tx.pricingRule.findFirst({
    where: {
      tier,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!rule) {
    throw conflict("no_pricing_rule", "This land is not on sale right now");
  }

  if (rule.inventoryLimit !== null) {
    const claimed = await tx.purchase.count({
      where: {
        pricingRuleId: rule.id,
        status: { in: [PURCHASE_STATUS.pending, PURCHASE_STATUS.completed] },
      },
    });
    if (claimed >= rule.inventoryLimit) {
      throw conflict("sold_out", "The founding release is sold out");
    }
  }

  return rule;
};

/** Public pricing snapshot for the landing page and plot panel. */
export const publicPricing = async (tier: string) => {
  const rule = await prisma.pricingRule.findFirst({
    where: { tier, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!rule) return null;
  return {
    priceMinor: Number(rule.priceMinor),
    currency: rule.currency,
    inventoryLimit: rule.inventoryLimit,
  };
};
