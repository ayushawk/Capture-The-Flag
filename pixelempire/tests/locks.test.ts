import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PLOT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
import { expireDueLocks } from "@/server/services/expire-locks";
import { createPurchase } from "@/server/services/purchases";
import { availablePlot, makeFakeGateway, makeUser, resetDynamicData } from "./helpers";

/** Rewinds a reservation so its window has already closed. */
const expireReservation = async (purchaseId: string): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `UPDATE "plot_locks"
     SET locked_at = NOW() - INTERVAL '20 minutes', expires_at = NOW() - INTERVAL '10 minutes'
     WHERE purchase_id = $1::uuid`,
    purchaseId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "purchases" SET expires_at = NOW() - INTERVAL '10 minutes' WHERE id = $1::uuid`,
    purchaseId,
  );
};

describe("plot locks (§11, §18, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("allows only one active lock per plot", async () => {
    const { user } = await makeUser("first");
    const plot = await availablePlot();
    const purchase = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);

    // A second active lock on the same plot is rejected by the database, not
    // merely by application code.
    await expect(
      prisma.plotLock.create({
        data: {
          plotId: plot.id,
          purchaseId: purchase.purchaseId,
          userId: user.id,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();

    expect(await prisma.plotLock.count({ where: { plotId: plot.id, releasedAt: null } })).toBe(1);
  });

  it("blocks a second buyer while the lock is live", async () => {
    const { user: first } = await makeUser("first");
    const { user: second } = await makeUser("second");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    await createPurchase(first.id, plot.id, fake.gateway);
    await expect(createPurchase(second.id, plot.id, fake.gateway)).rejects.toMatchObject({
      code: "plot_unavailable",
    });
  });

  it("expires the reservation and puts the plot back on the map", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const reservation = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);

    await expireReservation(reservation.purchaseId);
    const result = await expireDueLocks();

    expect(result.locksReleased).toBe(1);
    expect(result.purchasesExpired).toBe(1);
    expect(result.plotsReleased).toBe(1);

    const [after, purchase, lock] = await Promise.all([
      prisma.plot.findUniqueOrThrow({ where: { id: plot.id } }),
      prisma.purchase.findUniqueOrThrow({ where: { id: reservation.purchaseId } }),
      prisma.plotLock.findFirstOrThrow({ where: { purchaseId: reservation.purchaseId } }),
    ]);

    expect(after.status).toBe(PLOT_STATUS.available);
    expect(purchase.status).toBe(PURCHASE_STATUS.expired);
    expect(lock.releasedAt).not.toBeNull();
  });

  it("is safe to run repeatedly", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const reservation = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);
    await expireReservation(reservation.purchaseId);

    const first = await expireDueLocks();
    const second = await expireDueLocks();
    const third = await expireDueLocks();

    expect(first.locksReleased).toBe(1);
    expect(second.scanned).toBe(0);
    expect(third.scanned).toBe(0);
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      status: PLOT_STATUS.available,
    });
  });

  it("leaves a live reservation alone", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    await createPurchase(user.id, plot.id, makeFakeGateway().gateway);

    const result = await expireDueLocks();

    expect(result.scanned).toBe(0);
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      status: PLOT_STATUS.locked,
    });
  });

  it("never turns owned land back into available land", async () => {
    const { user, empire } = await makeUser("owner");
    const plot = await availablePlot();
    const reservation = await createPurchase(user.id, plot.id, makeFakeGateway().gateway);

    // Ownership lands, then the (now redundant) lock ages out.
    await prisma.$executeRawUnsafe(
      `UPDATE "plots" SET status='owned', owner_user_id=$1::uuid, owner_empire_id=$2::uuid, owned_at=NOW() WHERE id=$3::uuid`,
      user.id,
      empire.id,
      plot.id,
    );
    await expireReservation(reservation.purchaseId);

    const result = await expireDueLocks();

    expect(result.plotsReleased).toBe(0);
    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.status).toBe(PLOT_STATUS.owned);
    expect(after.ownerUserId).toBe(user.id);
  });

  it("reclaims a lapsed reservation inline so the next buyer does not wait for the sweeper", async () => {
    const { user: first } = await makeUser("first");
    const { user: second } = await makeUser("second");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const reservation = await createPurchase(first.id, plot.id, fake.gateway);
    await expireReservation(reservation.purchaseId);

    // No sweeper run in between.
    const taken = await createPurchase(second.id, plot.id, fake.gateway);
    expect(taken.purchaseId).not.toBe(reservation.purchaseId);

    const [old, lock] = await Promise.all([
      prisma.purchase.findUniqueOrThrow({ where: { id: reservation.purchaseId } }),
      prisma.plotLock.findFirstOrThrow({ where: { purchaseId: taken.purchaseId } }),
    ]);
    expect(old.status).toBe(PURCHASE_STATUS.expired);
    expect(lock.releasedAt).toBeNull();
    expect(await prisma.plotLock.count({ where: { plotId: plot.id, releasedAt: null } })).toBe(1);
  });
});
