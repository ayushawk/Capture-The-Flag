import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  ACQUISITION_TYPE,
  ACTIVITY_EVENT,
  PAYMENT_STATUS,
  PLOT_STATUS,
  PURCHASE_STATUS,
} from "@/lib/constants";
import { expireDueLocks } from "@/server/services/expire-locks";
import { finalizePurchase } from "@/server/services/finalize";
import { createPurchase } from "@/server/services/purchases";
import { processRazorpayWebhook } from "@/server/services/webhook";
import { verifyAndFinalize } from "@/server/services/verify-payment";
import {
  availablePlot,
  makeFakeGateway,
  makeUser,
  resetDynamicData,
  webhookBody,
} from "./helpers";

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

const buyAndPay = async (label: string) => {
  const { user, empire } = await makeUser(label);
  const plot = await availablePlot();
  const fake = makeFakeGateway();
  const reservation = await createPurchase(user.id, plot.id, fake.gateway);
  const payment = fake.pay(reservation.razorpayOrderId);
  return { user, empire, plot, fake, reservation, payment };
};

describe("ownership finalization (§16, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("creates exactly one owner and one history row", async () => {
    const { user, empire, plot, fake, reservation, payment } = await buyAndPay("owner");

    const result = await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    expect(result.outcome).toBe("completed");

    const [after, history, purchase, lock, events] = await Promise.all([
      prisma.plot.findUniqueOrThrow({ where: { id: plot.id } }),
      prisma.ownershipHistory.findMany({ where: { plotId: plot.id } }),
      prisma.purchase.findUniqueOrThrow({ where: { id: reservation.purchaseId } }),
      prisma.plotLock.findFirstOrThrow({ where: { purchaseId: reservation.purchaseId } }),
      prisma.activityEvent.findMany({ where: { plotId: plot.id } }),
    ]);

    expect(after.status).toBe(PLOT_STATUS.owned);
    expect(after.ownerUserId).toBe(user.id);
    expect(after.ownerEmpireId).toBe(empire.id);
    expect(after.ownedAt).not.toBeNull();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      ownerUserId: user.id,
      ownerEmpireId: empire.id,
      acquisitionType: ACQUISITION_TYPE.purchase,
      purchaseId: reservation.purchaseId,
      endedAt: null,
    });

    expect(purchase.status).toBe(PURCHASE_STATUS.completed);
    expect(purchase.completedAt).not.toBeNull();
    expect(lock.releasedAt).not.toBeNull();

    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe(ACTIVITY_EVENT.territoryClaimed);
    // Public feed only: no payment information leaks into activity (§21).
    expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/amount|payment|order|razorpay/i);
  });

  it("does nothing the second time finalization runs (§38)", async () => {
    const { user, fake, reservation, payment, plot } = await buyAndPay("owner");

    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    const stored = await prisma.payment.findFirstOrThrow({ where: { providerPaymentId: payment.id } });
    const before = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });

    const again = await finalizePurchase(reservation.purchaseId, stored.id);
    const third = await finalizePurchase(reservation.purchaseId, stored.id);

    expect(again).toMatchObject({ outcome: "completed", firstTime: false });
    expect(third).toMatchObject({ outcome: "completed", firstTime: false });

    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.ownedAt?.toISOString()).toBe(before.ownedAt?.toISOString());
    expect(await prisma.ownershipHistory.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { plotId: plot.id } })).toBe(1);
  });

  it("never grants ownership from a payment that is not paid", async () => {
    const { fake, reservation, plot } = await buyAndPay("owner");
    const failed = fake.pay(reservation.razorpayOrderId, { status: "failed" });
    const body = webhookBody(failed, reservation.purchaseId, "payment.failed");
    await processRazorpayWebhook(body, fake.signWebhook(body), "evt_f", fake.gateway);

    const stored = await prisma.payment.findFirstOrThrow({ where: { providerPaymentId: failed.id } });
    const result = await finalizePurchase(reservation.purchaseId, stored.id);

    expect(result.outcome).toBe("ignored");
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      ownerUserId: null,
    });
  });

  it("finalizes a payment that lands after the lock expired, if the plot is still free (§17)", async () => {
    const { user, plot, fake, reservation, payment } = await buyAndPay("latecomer");

    // 10:10 — the lock lapses and the sweeper puts the plot back on sale.
    await expireReservation(reservation.purchaseId);
    await expireDueLocks();
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      status: PLOT_STATUS.available,
    });

    // 10:11 — the webhook for a payment made at 10:09 finally arrives.
    const body = webhookBody(payment, reservation.purchaseId);
    const result = await processRazorpayWebhook(body, fake.signWebhook(body), "evt_late", fake.gateway);

    expect(result.reason).toBe("completed");
    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.status).toBe(PLOT_STATUS.owned);
    expect(after.ownerUserId).toBe(user.id);
  });

  it("never overwrites an existing owner, and routes the money to refund (§17)", async () => {
    const first = await buyAndPay("slow");

    // The slow buyer's reservation lapses and the plot returns to the map.
    await expireReservation(first.reservation.purchaseId);
    await expireDueLocks();

    // A second buyer claims and pays for the same plot.
    const { user: fastUser } = await makeUser("fast");
    const fastGateway = makeFakeGateway();
    const fastReservation = await createPurchase(fastUser.id, first.plot.id, fastGateway.gateway);
    const fastPayment = fastGateway.pay(fastReservation.razorpayOrderId);
    await verifyAndFinalize(
      {
        userId: fastUser.id,
        purchaseId: fastReservation.purchaseId,
        razorpayOrderId: fastReservation.razorpayOrderId,
        razorpayPaymentId: fastPayment.id,
        razorpaySignature: fastGateway.sign(fastReservation.razorpayOrderId, fastPayment.id),
      },
      fastGateway.gateway,
    );

    // Now the slow buyer's late payment arrives.
    const body = webhookBody(first.payment, first.reservation.purchaseId);
    const result = await processRazorpayWebhook(
      body,
      first.fake.signWebhook(body),
      "evt_too_late",
      first.fake.gateway,
    );

    expect(result.reason).toBe("refund_required");

    const after = await prisma.plot.findUniqueOrThrow({ where: { id: first.plot.id } });
    expect(after.ownerUserId).toBe(fastUser.id);
    expect(after.ownerUserId).not.toBe(first.user.id);

    // Exactly one owner, one history row, and an exception filed for the refund.
    expect(await prisma.ownershipHistory.count({ where: { plotId: first.plot.id } })).toBe(1);
    const exceptions = await prisma.paymentException.findMany();
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe("plot_owned_by_another_user");
    expect(exceptions[0]!.resolvedAt).toBeNull();
  });

  it("refunds a second successful payment on a purchase that is already complete (§10)", async () => {
    const { user, fake, reservation, payment, plot } = await buyAndPay("owner");

    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    const secondPayment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(secondPayment, reservation.purchaseId);
    const result = await processRazorpayWebhook(body, fake.signWebhook(body), "evt_2", fake.gateway);

    expect(result.reason).toBe("refund_required");

    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.ownerUserId).toBe(user.id);
    expect(await prisma.ownershipHistory.count({ where: { plotId: plot.id } })).toBe(1);

    const exceptions = await prisma.paymentException.findMany();
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe("extra_payment_on_completed_purchase");
  });

  it("refuses to sell a plot an administrator disabled mid-checkout", async () => {
    const { fake, reservation, plot } = await buyAndPay("owner");

    await prisma.$executeRawUnsafe(
      `UPDATE "plots" SET status = 'disabled' WHERE id = $1::uuid`,
      plot.id,
    );

    const body = webhookBody(fake.pay(reservation.razorpayOrderId), reservation.purchaseId);
    const result = await processRazorpayWebhook(body, fake.signWebhook(body), "evt_dis", fake.gateway);

    expect(result.reason).toBe("refund_required");
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      ownerUserId: null,
    });
    expect((await prisma.paymentException.findMany())[0]!.reason).toBe("plot_not_sellable");
  });
});

describe("ownership invariants enforced by the database (§37)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("refuses an owned plot without an owner", async () => {
    const plot = await availablePlot();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "plots" SET status='owned' WHERE id = $1::uuid`, plot.id),
    ).rejects.toThrow();
  });

  it("refuses owner columns on a plot that is not owned", async () => {
    const { user } = await makeUser("someone");
    const plot = await availablePlot();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "plots" SET owner_user_id = $1::uuid WHERE id = $2::uuid`,
        user.id,
        plot.id,
      ),
    ).rejects.toThrow();
  });

  it("keeps ownership history append-only", async () => {
    const { user, fake, reservation, payment } = await buyAndPay("owner");
    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    const row = await prisma.ownershipHistory.findFirstOrThrow({ where: { plotId: reservation.plotId } });

    // Deleting history is impossible.
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "ownership_history" WHERE id = $1::uuid`, row.id),
    ).rejects.toThrow();

    // So is rewriting who owned what.
    const { user: other } = await makeUser("other");
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "ownership_history" SET owner_user_id = $1::uuid WHERE id = $2::uuid`,
        other.id,
        row.id,
      ),
    ).rejects.toThrow();

    // Closing the row is the one permitted update.
    await prisma.$executeRawUnsafe(
      `UPDATE "ownership_history" SET ended_at = NOW() WHERE id = $1::uuid`,
      row.id,
    );
    const closed = await prisma.ownershipHistory.findUniqueOrThrow({ where: { id: row.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.ownerUserId).toBe(user.id);
  });

  it("allows only one open history row per plot", async () => {
    const { user, empire, fake, reservation, payment } = await buyAndPay("owner");
    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    await expect(
      prisma.ownershipHistory.create({
        data: {
          plotId: reservation.plotId,
          ownerUserId: user.id,
          ownerEmpireId: empire.id,
          acquisitionType: ACQUISITION_TYPE.adminTransfer,
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("marks the finalizing payment as paid", async () => {
    const { user, fake, reservation, payment } = await buyAndPay("owner");
    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );
    const stored = await prisma.payment.findFirstOrThrow({ where: { providerPaymentId: payment.id } });
    expect(stored.status).toBe(PAYMENT_STATUS.paid);
  });
});
