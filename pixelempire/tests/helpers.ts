import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { hmacSha256Hex } from "@/lib/crypto";
import { PLOT_STATUS, PLOT_TIER } from "@/lib/constants";
import type { GatewayOrder, GatewayPayment, PaymentGateway } from "@/server/payments/gateway";

export const TEST_KEY_SECRET = "rzp_test_secret";
export const TEST_WEBHOOK_SECRET = "rzp_test_webhook_secret";

/**
 * Returns the database to the state the seed leaves it in, without dropping the
 * 10,000 plots. Ownership history is append-only in production, so the trigger
 * is lifted just for this teardown.
 */
export const resetDynamicData = async (): Promise<void> => {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ownership_history" DISABLE TRIGGER "ownership_history_append_only_trg"`,
  );
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "ownership_history"`);
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ownership_history" ENABLE TRIGGER "ownership_history_append_only_trg"`,
    );
  }

  await prisma.paymentException.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.plotLock.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.purchase.deleteMany();

  // Plots back to their released state; ownership columns cleared together so
  // the ownership CHECK constraint holds at every instant.
  await prisma.$executeRawUnsafe(`
    UPDATE "plots"
    SET status = CASE WHEN tier = 'founding' THEN 'available' ELSE 'unreleased' END,
        owner_user_id = NULL, owner_empire_id = NULL, owned_at = NULL`);

  await prisma.session.deleteMany();
  await prisma.loginToken.deleteMany();
  await prisma.empire.deleteMany();
  await prisma.user.deleteMany();
};

let userCounter = 0;

export const makeUser = async (label = "user") => {
  userCounter += 1;
  const email = `${label}-${userCounter}-${randomUUID().slice(0, 8)}@example.test`;
  const user = await prisma.user.create({ data: { email, displayName: label } });
  const empire = await prisma.empire.create({
    data: {
      ownerUserId: user.id,
      name: `${label} empire ${userCounter}`,
      slug: `${label}-${userCounter}-${randomUUID().slice(0, 6)}`,
    },
  });
  return { user, empire };
};

/** An available founding plot nobody has touched. */
export const availablePlot = async () => {
  const plot = await prisma.plot.findFirst({
    where: { status: PLOT_STATUS.available, tier: PLOT_TIER.founding },
    orderBy: [{ gridY: "asc" }, { gridX: "asc" }],
  });
  if (!plot) throw new Error("no available plot in the test database");
  return plot;
};

export const plotAt = async (gridX: number, gridY: number) => {
  const plot = await prisma.plot.findUnique({ where: { gridX_gridY: { gridX, gridY } } });
  if (!plot) throw new Error(`no plot at ${gridX},${gridY}`);
  return plot;
};

export const setPlotStatus = async (plotId: string, status: string): Promise<void> => {
  await prisma.$executeRawUnsafe(`UPDATE "plots" SET status = $1 WHERE id = $2::uuid`, status, plotId);
};

export const foundingRule = async () => {
  const rule = await prisma.pricingRule.findFirst({ where: { tier: PLOT_TIER.founding, isActive: true } });
  if (!rule) throw new Error("no active founding pricing rule");
  return rule;
};

// --------------------------------------------------------------- fake gateway

export interface FakeGatewayControls {
  gateway: PaymentGateway;
  /** Simulate a successful capture and return the checkout callback payload. */
  pay: (orderId: string, overrides?: Partial<GatewayPayment>) => GatewayPayment;
  sign: (orderId: string, paymentId: string) => string;
  signWebhook: (body: string) => string;
  orders: Map<string, GatewayOrder>;
  payments: Map<string, GatewayPayment>;
  failNextOrder: () => void;
  createdOrders: number;
}

/**
 * An in-memory Razorpay stand-in.
 *
 * Signatures are computed with the same HMAC construction and the same test
 * secret the application is configured with, so signature verification is
 * genuinely exercised rather than stubbed out.
 */
// Provider ids are globally unique in reality, so they must be unique across
// gateway instances here too — otherwise a test with two buyers would have
// their payments collide on the (provider, provider_payment_id) index.
let orderSeq = 0;
let paymentSeq = 0;

export const makeFakeGateway = (): FakeGatewayControls => {
  const orders = new Map<string, GatewayOrder>();
  const payments = new Map<string, GatewayPayment>();
  let failOrder = false;

  const controls: FakeGatewayControls = {
    orders,
    payments,
    createdOrders: 0,
    failNextOrder: () => {
      failOrder = true;
    },
    sign: (orderId, paymentId) => hmacSha256Hex(TEST_KEY_SECRET, `${orderId}|${paymentId}`),
    signWebhook: (body) => hmacSha256Hex(TEST_WEBHOOK_SECRET, body),
    pay: (orderId, overrides = {}) => {
      const order = orders.get(orderId);
      if (!order) throw new Error(`unknown order ${orderId}`);
      paymentSeq += 1;
      const payment: GatewayPayment = {
        id: `pay_test_${paymentSeq}`,
        orderId,
        amountMinor: order.amountMinor,
        currency: order.currency,
        status: "captured",
        method: "card",
        ...overrides,
      };
      payments.set(payment.id, payment);
      return payment;
    },
    gateway: {
      provider: "razorpay",
      async createOrder({ amountMinor, currency }) {
        if (failOrder) {
          failOrder = false;
          throw new Error("simulated provider outage");
        }
        orderSeq += 1;
        controls.createdOrders += 1;
        const order: GatewayOrder = {
          id: `order_test_${orderSeq}`,
          amountMinor,
          currency,
          status: "created",
        };
        orders.set(order.id, order);
        return order;
      },
      async fetchPayment(paymentId) {
        const payment = payments.get(paymentId);
        if (!payment) throw new Error(`unknown payment ${paymentId}`);
        return payment;
      },
      verifyCheckoutSignature({ orderId, paymentId, signature }) {
        return hmacSha256Hex(TEST_KEY_SECRET, `${orderId}|${paymentId}`) === signature;
      },
      verifyWebhookSignature(rawBody, signature) {
        return hmacSha256Hex(TEST_WEBHOOK_SECRET, rawBody) === signature;
      },
    },
  };

  return controls;
};

/** A Razorpay-shaped webhook body for a captured payment. */
export const webhookBody = (payment: GatewayPayment, purchaseId: string, event = "payment.captured") =>
  JSON.stringify({
    event,
    payload: {
      payment: {
        entity: {
          id: payment.id,
          order_id: payment.orderId,
          amount: payment.amountMinor,
          currency: payment.currency,
          status: payment.status,
          method: payment.method ?? "card",
          notes: { purchaseId },
        },
      },
    },
  });
