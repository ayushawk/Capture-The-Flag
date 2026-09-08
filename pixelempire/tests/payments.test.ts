import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PAYMENT_STATUS, PURCHASE_STATUS } from "@/lib/constants";
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

const setUp = async () => {
  const { user, empire } = await makeUser("buyer");
  const plot = await availablePlot();
  const fake = makeFakeGateway();
  const reservation = await createPurchase(user.id, plot.id, fake.gateway);
  return { user, empire, plot, fake, reservation };
};

describe("payment verification (§14, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("accepts a correctly signed, correctly priced payment", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);

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
    const stored = await prisma.payment.findFirstOrThrow({
      where: { providerPaymentId: payment.id },
    });
    expect(stored.status).toBe(PAYMENT_STATUS.paid);
  });

  it("rejects an invalid signature", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);

    await expect(
      verifyAndFinalize(
        {
          userId: user.id,
          purchaseId: reservation.purchaseId,
          razorpayOrderId: reservation.razorpayOrderId,
          razorpayPaymentId: payment.id,
          razorpaySignature: "deadbeef",
        },
        fake.gateway,
      ),
    ).rejects.toMatchObject({ code: "invalid_signature" });

    const plot = await prisma.plot.findUniqueOrThrow({ where: { id: reservation.plotId } });
    expect(plot.ownerUserId).toBeNull();
  });

  it("rejects a payment whose amount does not match the purchase", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId, { amountMinor: 1 });

    await expect(
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
    ).rejects.toMatchObject({ code: "amount_mismatch" });
  });

  it("rejects a payment in the wrong currency", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId, { currency: "INR" });

    await expect(
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
    ).rejects.toMatchObject({ code: "currency_mismatch" });
  });

  it("rejects a payment that belongs to a different order", async () => {
    const { user, fake, reservation } = await setUp();
    const otherOrder = await fake.gateway.createOrder({
      amountMinor: 100,
      currency: "USD",
      receipt: "other",
    });
    const payment = fake.pay(otherOrder.id);

    await expect(
      verifyAndFinalize(
        {
          userId: user.id,
          purchaseId: reservation.purchaseId,
          razorpayOrderId: otherOrder.id,
          razorpayPaymentId: payment.id,
          razorpaySignature: fake.sign(otherOrder.id, payment.id),
        },
        fake.gateway,
      ),
    ).rejects.toMatchObject({ code: "order_mismatch" });
  });

  it("refuses to verify someone else's reservation", async () => {
    const { fake, reservation } = await setUp();
    const { user: stranger } = await makeUser("stranger");
    const payment = fake.pay(reservation.razorpayOrderId);

    await expect(
      verifyAndFinalize(
        {
          userId: stranger.id,
          purchaseId: reservation.purchaseId,
          razorpayOrderId: reservation.razorpayOrderId,
          razorpayPaymentId: payment.id,
          razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
        },
        fake.gateway,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("records several attempts against one purchase (§9, §10)", async () => {
    const { user, fake, reservation } = await setUp();

    const failedA = fake.pay(reservation.razorpayOrderId, { status: "failed" });
    const failedB = fake.pay(reservation.razorpayOrderId, { status: "failed" });
    const captured = fake.pay(reservation.razorpayOrderId);

    for (const attempt of [failedA, failedB, captured]) {
      await verifyAndFinalize(
        {
          userId: user.id,
          purchaseId: reservation.purchaseId,
          razorpayOrderId: reservation.razorpayOrderId,
          razorpayPaymentId: attempt.id,
          razorpaySignature: fake.sign(reservation.razorpayOrderId, attempt.id),
        },
        fake.gateway,
      );
    }

    const payments = await prisma.payment.findMany({
      where: { purchaseId: reservation.purchaseId },
      orderBy: { createdAt: "asc" },
    });

    // Three attempts, three rows — one purchase, one order.
    expect(payments).toHaveLength(3);
    expect(payments.filter((p) => p.status === PAYMENT_STATUS.failed)).toHaveLength(2);
    expect(payments.filter((p) => p.status === PAYMENT_STATUS.paid)).toHaveLength(1);

    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: reservation.purchaseId } });
    expect(purchase.status).toBe(PURCHASE_STATUS.completed);
  });
});

describe("webhook processing (§15, §45)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("rejects an unsigned or badly signed delivery", async () => {
    const { fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(payment, reservation.purchaseId);

    await expect(processRazorpayWebhook(body, null, "evt_1", fake.gateway)).rejects.toMatchObject({
      code: "missing_signature",
    });
    await expect(processRazorpayWebhook(body, "nope", "evt_1", fake.gateway)).rejects.toMatchObject({
      code: "invalid_signature",
    });

    const plot = await prisma.plot.findUniqueOrThrow({ where: { id: reservation.plotId } });
    expect(plot.ownerUserId).toBeNull();
  });

  it("finalizes ownership from a signed capture event", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(payment, reservation.purchaseId);

    const result = await processRazorpayWebhook(body, fake.signWebhook(body), "evt_1", fake.gateway);

    expect(result.handled).toBe(true);
    const plot = await prisma.plot.findUniqueOrThrow({ where: { id: reservation.plotId } });
    expect(plot.ownerUserId).toBe(user.id);
  });

  it("is idempotent when the same event is delivered twice (§15, §38)", async () => {
    const { fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(payment, reservation.purchaseId);
    const signature = fake.signWebhook(body);

    const first = await processRazorpayWebhook(body, signature, "evt_dup", fake.gateway);
    const second = await processRazorpayWebhook(body, signature, "evt_dup", fake.gateway);

    expect(first.handled).toBe(true);
    expect(second.reason).toBe("duplicate_event");

    // No duplicate ownership, history, payment rows or activity events.
    const [history, payments, events, exceptions] = await Promise.all([
      prisma.ownershipHistory.count({ where: { plotId: reservation.plotId } }),
      prisma.payment.count({ where: { purchaseId: reservation.purchaseId } }),
      prisma.activityEvent.count({ where: { plotId: reservation.plotId } }),
      prisma.paymentException.count(),
    ]);
    expect(history).toBe(1);
    expect(payments).toBe(1);
    expect(events).toBe(1);
    expect(exceptions).toBe(0);
  });

  it("converges on one payment row when the callback and the webhook both arrive", async () => {
    const { user, fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId);
    const body = webhookBody(payment, reservation.purchaseId);

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
    await processRazorpayWebhook(body, fake.signWebhook(body), "evt_both", fake.gateway);

    expect(await prisma.payment.count({ where: { purchaseId: reservation.purchaseId } })).toBe(1);
    expect(await prisma.ownershipHistory.count({ where: { plotId: reservation.plotId } })).toBe(1);
    expect(await prisma.paymentException.count()).toBe(0);
  });

  it("records a failed payment without touching the reservation", async () => {
    const { fake, reservation } = await setUp();
    const payment = fake.pay(reservation.razorpayOrderId, { status: "failed" });
    const body = webhookBody(payment, reservation.purchaseId, "payment.failed");

    await processRazorpayWebhook(body, fake.signWebhook(body), "evt_failed", fake.gateway);

    const [plot, purchase] = await Promise.all([
      prisma.plot.findUniqueOrThrow({ where: { id: reservation.plotId } }),
      prisma.purchase.findUniqueOrThrow({ where: { id: reservation.purchaseId } }),
    ]);
    expect(plot.ownerUserId).toBeNull();
    expect(purchase.status).toBe(PURCHASE_STATUS.pending);
  });
});
