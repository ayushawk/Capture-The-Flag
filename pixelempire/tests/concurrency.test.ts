import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PLOT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
import { expireDueLocks } from "@/server/services/expire-locks";
import { finalizePurchase } from "@/server/services/finalize";
import { createPurchase } from "@/server/services/purchases";
import { verifyAndFinalize } from "@/server/services/verify-payment";
import { processRazorpayWebhook } from "@/server/services/webhook";
import {
  availablePlot,
  makeFakeGateway,
  makeUser,
  resetDynamicData,
  webhookBody,
} from "./helpers";

describe("race conditions (§38, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("lets exactly one of two simultaneous claims win", async () => {
    const [{ user: alice }, { user: bob }] = await Promise.all([makeUser("alice"), makeUser("bob")]);
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const results = await Promise.allSettled([
      createPurchase(alice.id, plot.id, fake.gateway),
      createPurchase(bob.id, plot.id, fake.gateway),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "plot_unavailable",
    });

    // One reservation, one lock, one locked plot.
    expect(await prisma.purchase.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.plotLock.count({ where: { plotId: plot.id, releasedAt: null } })).toBe(1);
    expect(await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } })).toMatchObject({
      status: PLOT_STATUS.locked,
    });
  });

  it("holds up when five people go for the same plot at once", async () => {
    const users = await Promise.all([
      makeUser("a"),
      makeUser("b"),
      makeUser("c"),
      makeUser("d"),
      makeUser("e"),
    ]);
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const results = await Promise.allSettled(
      users.map(({ user }) => createPurchase(user.id, plot.id, fake.gateway)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.purchase.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.plotLock.count({ where: { plotId: plot.id, releasedAt: null } })).toBe(1);
  });

  it("creates one owner when two finalizations run at the same time", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();
    const reservation = await createPurchase(user.id, plot.id, fake.gateway);
    const payment = fake.pay(reservation.razorpayOrderId);

    // Record the attempt once, then race two finalizations of it.
    const body = webhookBody(payment, reservation.purchaseId);
    await processRazorpayWebhook(body, fake.signWebhook(body), "evt_race_setup", fake.gateway);
    const stored = await prisma.payment.findFirstOrThrow({ where: { providerPaymentId: payment.id } });

    const results = await Promise.all([
      finalizePurchase(reservation.purchaseId, stored.id),
      finalizePurchase(reservation.purchaseId, stored.id),
      finalizePurchase(reservation.purchaseId, stored.id),
    ]);

    for (const result of results) expect(result.outcome).toBe("completed");

    expect(await prisma.ownershipHistory.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.paymentException.count()).toBe(0);

    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.ownerUserId).toBe(user.id);
  });

  it("survives the browser callback and the webhook landing together (§38)", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();
    const reservation = await createPurchase(user.id, plot.id, fake.gateway);
    const payment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(payment, reservation.purchaseId);

    const [callback, webhook] = await Promise.allSettled([
      verifyAndFinalize(
        {
          userId: user.id,
          purchaseId: reservation.purchaseId,
          razorpayOrderId: reservation.razorpayOrderId,
          razorpayPaymentId: payment.id,
          razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
        },
        fake.gateway,
      ),
      processRazorpayWebhook(body, fake.signWebhook(body), "evt_simultaneous", fake.gateway),
    ]);

    expect(callback.status).toBe("fulfilled");
    expect(webhook.status).toBe("fulfilled");

    // One payment row, one owner, one history row, one activity event.
    expect(await prisma.payment.count({ where: { purchaseId: reservation.purchaseId } })).toBe(1);
    expect(await prisma.ownershipHistory.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.activityEvent.count({ where: { plotId: plot.id } })).toBe(1);
    expect(await prisma.paymentException.count()).toBe(0);

    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.status).toBe(PLOT_STATUS.owned);
    expect(after.ownerUserId).toBe(user.id);
  });

  it("does not deadlock when the sweeper meets a landing payment", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();
    const reservation = await createPurchase(user.id, plot.id, fake.gateway);
    const payment = fake.pay(reservation.razorpayOrderId);

    // The reservation lapses at the exact moment the payment is confirmed.
    await prisma.$executeRawUnsafe(
      `UPDATE "plot_locks"
       SET locked_at = NOW() - INTERVAL '20 minutes', expires_at = NOW() - INTERVAL '10 minutes'
       WHERE purchase_id = $1::uuid`,
      reservation.purchaseId,
    );

    const body = webhookBody(payment, reservation.purchaseId);
    const results = await Promise.allSettled([
      expireDueLocks(),
      processRazorpayWebhook(body, fake.signWebhook(body), "evt_sweep_race", fake.gateway),
      expireDueLocks(),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    // Whichever order they interleaved in, the paid plot ends up owned and the
    // sweeper never took it back.
    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    expect(after.status).toBe(PLOT_STATUS.owned);
    expect(after.ownerUserId).toBe(user.id);
    expect(await prisma.ownershipHistory.count({ where: { plotId: plot.id } })).toBe(1);
  });

  it("does not deadlock when a new claim meets a landing payment on a lapsed reservation", async () => {
    const { user: first } = await makeUser("first");
    const { user: second } = await makeUser("second");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const reservation = await createPurchase(first.id, plot.id, fake.gateway);
    const payment = fake.pay(reservation.razorpayOrderId);
    await prisma.$executeRawUnsafe(
      `UPDATE "plot_locks"
       SET locked_at = NOW() - INTERVAL '20 minutes', expires_at = NOW() - INTERVAL '10 minutes'
       WHERE purchase_id = $1::uuid`,
      reservation.purchaseId,
    );

    const body = webhookBody(payment, reservation.purchaseId);
    const results = await Promise.allSettled([
      processRazorpayWebhook(body, fake.signWebhook(body), "evt_claim_race", fake.gateway),
      createPurchase(second.id, plot.id, fake.gateway),
    ]);

    // Neither side may fail with a database deadlock.
    for (const result of results) {
      if (result.status === "rejected") {
        expect(String(result.reason?.message ?? result.reason)).not.toMatch(/deadlock/i);
      }
    }

    // Whatever the interleaving, the plot has at most one owner and one open
    // history row — the invariant that actually matters.
    const after = await prisma.plot.findUniqueOrThrow({ where: { id: plot.id } });
    const history = await prisma.ownershipHistory.count({
      where: { plotId: plot.id, endedAt: null },
    });
    const activeLocks = await prisma.plotLock.count({ where: { plotId: plot.id, releasedAt: null } });

    expect(history).toBeLessThanOrEqual(1);
    expect(activeLocks).toBeLessThanOrEqual(1);
    if (after.status === PLOT_STATUS.owned) {
      expect(after.ownerUserId).toBe(first.id);
      expect(history).toBe(1);
    }
  });

  it("keeps a payment retry on one purchase rather than forking reservations", async () => {
    const { user } = await makeUser("buyer");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const results = await Promise.all([
      createPurchase(user.id, plot.id, fake.gateway),
      createPurchase(user.id, plot.id, fake.gateway),
      createPurchase(user.id, plot.id, fake.gateway),
    ]);

    const ids = new Set(results.map((result) => result.purchaseId));
    expect(ids.size).toBe(1);
    expect(await prisma.purchase.count({ where: { plotId: plot.id, status: PURCHASE_STATUS.pending } })).toBe(1);
  });
});
