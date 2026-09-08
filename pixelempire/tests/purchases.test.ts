import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PLOT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
import { ApiError } from "@/lib/http";
import { createPurchaseSchema } from "@/lib/validation";
import { createPurchase } from "@/server/services/purchases";
import {
  availablePlot,
  foundingRule,
  makeFakeGateway,
  makeUser,
  plotAt,
  resetDynamicData,
  setPlotStatus,
} from "./helpers";

describe("purchase creation (§12, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("reserves an available plot, locks it and creates a pending purchase", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const result = await createPurchase(user.id, plot.id, fake.gateway);

    expect(result.status).toBe(PURCHASE_STATUS.pending);
    expect(result.razorpayOrderId).toMatch(/^order_test_/);
    expect(result.reused).toBe(false);

    const [after, purchase, lock] = await Promise.all([
      prisma.plot.findUniqueOrThrow({ where: { id: plot.id } }),
      prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId } }),
      prisma.plotLock.findFirstOrThrow({ where: { plotId: plot.id, releasedAt: null } }),
    ]);

    expect(after.status).toBe(PLOT_STATUS.locked);
    expect(after.ownerUserId).toBeNull();
    expect(purchase.status).toBe(PURCHASE_STATUS.pending);
    expect(lock.purchaseId).toBe(purchase.id);

    // Ten-minute window (§11).
    const windowMs = lock.expiresAt.getTime() - lock.lockedAt.getTime();
    expect(windowMs).toBe(10 * 60_000);
  });

  it("takes the price from the server's pricing rule, not the client", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const rule = await foundingRule();

    const result = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId } });

    expect(purchase.amountMinor).toBe(rule.priceMinor);
    expect(purchase.amountMinor).toBe(BigInt(100));
    expect(purchase.currency).toBe("USD");
    expect(purchase.pricingRuleId).toBe(rule.id);
  });

  it("accepts only a plot id from the client (§12)", () => {
    const parsed = createPurchaseSchema.parse({
      plotId: "6f0d5a1e-0000-4000-8000-000000000000",
      amountMinor: 1,
      currency: "XXX",
      userId: "someone-else",
      empireId: "theirs",
    });
    expect(parsed).toEqual({ plotId: "6f0d5a1e-0000-4000-8000-000000000000" });
  });

  it("keeps the purchase amount stable when the pricing rule changes later (§8)", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const rule = await foundingRule();

    const result = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { priceMinor: BigInt(5000) } });

    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId } });
    expect(purchase.amountMinor).toBe(BigInt(100));

    await prisma.pricingRule.update({ where: { id: rule.id }, data: { priceMinor: BigInt(100) } });
  });

  const rejected = async (status: string, expectedCode: string) => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    await setPlotStatus(plot.id, status);

    await expect(createPurchase(user.id, plot.id, makeFakeGateway().gateway)).rejects.toMatchObject({
      code: expectedCode,
    });
  };

  it("refuses an unreleased plot", () => rejected(PLOT_STATUS.unreleased, "plot_unavailable"));
  it("refuses a disabled plot", () => rejected(PLOT_STATUS.disabled, "plot_unavailable"));
  it("refuses a plot already being claimed", () => rejected(PLOT_STATUS.locked, "plot_unavailable"));

  it("refuses a plot that is already owned", async () => {
    const { user: owner, empire } = await makeUser("owner");
    const { user: other } = await makeUser("other");
    const plot = await availablePlot();

    await prisma.$executeRawUnsafe(
      `UPDATE "plots" SET status='owned', owner_user_id=$1::uuid, owner_empire_id=$2::uuid, owned_at=NOW() WHERE id=$3::uuid`,
      owner.id,
      empire.id,
      plot.id,
    );

    await expect(createPurchase(other.id, plot.id, makeFakeGateway().gateway)).rejects.toMatchObject({
      code: "plot_owned",
    });
  });

  it("returns 404 for a plot that does not exist", async () => {
    const { user } = await makeUser("buyer");
    await expect(
      createPurchase(user.id, "00000000-0000-4000-8000-000000000000", makeFakeGateway().gateway),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("hands back the same reservation when the buyer retries (§10)", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const first = await createPurchase(user.id, plot.id, fake.gateway);
    const second = await createPurchase(user.id, plot.id, fake.gateway);

    expect(second.purchaseId).toBe(first.purchaseId);
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(second.reused).toBe(true);
    // One order, not two — retrying payment must not spawn reservations.
    expect(fake.createdOrders).toBe(1);
    expect(await prisma.purchase.count({ where: { plotId: plot.id } })).toBe(1);
  });

  it("releases the plot when the provider cannot create an order (§13)", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();
    fake.failNextOrder();

    await expect(createPurchase(user.id, plot.id, fake.gateway)).rejects.toThrow();

    const [after, purchase, activeLock] = await Promise.all([
      prisma.plot.findUniqueOrThrow({ where: { id: plot.id } }),
      prisma.purchase.findFirstOrThrow({ where: { plotId: plot.id } }),
      prisma.plotLock.findFirst({ where: { plotId: plot.id, releasedAt: null } }),
    ]);

    expect(after.status).toBe(PLOT_STATUS.available);
    expect(purchase.status).toBe(PURCHASE_STATUS.cancelled);
    expect(activeLock).toBeNull();

    // And the plot is immediately claimable again.
    const retry = await createPurchase(user.id, plot.id, fake.gateway);
    expect(retry.status).toBe(PURCHASE_STATUS.pending);
  });

  it("caps how many unpaid reservations one account can hold", async () => {
    const { user } = await makeUser("squatter");
    const fake = makeFakeGateway();

    const plots = await prisma.plot.findMany({
      where: { status: PLOT_STATUS.available },
      take: 6,
      orderBy: [{ gridY: "asc" }, { gridX: "asc" }],
    });

    for (const plot of plots.slice(0, 5)) {
      await createPurchase(user.id, plot.id, fake.gateway);
    }

    await expect(createPurchase(user.id, plots[5]!.id, fake.gateway)).rejects.toMatchObject({
      code: "too_many_reservations",
    });
  });

  it("stops selling once the pricing rule's inventory limit is reached", async () => {
    const rule = await foundingRule();
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { inventoryLimit: 1 } });

    try {
      const { user: first } = await makeUser("first");
      const { user: second } = await makeUser("second");
      const fake = makeFakeGateway();

      await createPurchase(first.id, (await plotAt(49, 49)).id, fake.gateway);
      await expect(createPurchase(second.id, (await plotAt(50, 49)).id, fake.gateway)).rejects.toMatchObject({
        code: "sold_out",
      });
    } finally {
      await prisma.pricingRule.update({ where: { id: rule.id }, data: { inventoryLimit: 1000 } });
    }
  });
});
