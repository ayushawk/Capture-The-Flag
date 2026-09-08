import { hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PAYMENT_PROVIDER } from "@/lib/constants";
import { GatewayError, type GatewayOrder, type GatewayPayment, type PaymentGateway } from "./gateway";

const API_BASE = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 12_000;

const authHeader = (): string =>
  `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`;

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const description =
        (body.error as { description?: string } | undefined)?.description ?? response.statusText;
      throw new GatewayError(`Razorpay ${path} failed: ${description}`, response.status, body);
    }
    return body as T;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayError("Razorpay request timed out");
    }
    throw new GatewayError(error instanceof Error ? error.message : "Razorpay request failed");
  } finally {
    clearTimeout(timer);
  }
};

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayPaymentResponse {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
}

export const razorpayGateway: PaymentGateway = {
  provider: PAYMENT_PROVIDER,

  async createOrder({ amountMinor, currency, receipt, notes }): Promise<GatewayOrder> {
    const order = await request<RazorpayOrderResponse>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: amountMinor,
        currency,
        receipt,
        payment_capture: 1,
        notes,
      }),
    });
    logger.info("razorpay.order_created", { providerOrderId: order.id, amountMinor, currency });
    return { id: order.id, amountMinor: order.amount, currency: order.currency, status: order.status };
  },

  async fetchPayment(paymentId): Promise<GatewayPayment> {
    const payment = await request<RazorpayPaymentResponse>(`/payments/${encodeURIComponent(paymentId)}`);
    return {
      id: payment.id,
      orderId: payment.order_id,
      amountMinor: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method ?? null,
    };
  },

  verifyCheckoutSignature({ orderId, paymentId, signature }): boolean {
    const expected = hmacSha256Hex(env.razorpayKeySecret, `${orderId}|${paymentId}`);
    return safeEqual(expected, signature);
  },

  verifyWebhookSignature(rawBody, signature): boolean {
    const expected = hmacSha256Hex(env.razorpayWebhookSecret, rawBody);
    return safeEqual(expected, signature);
  },
};
