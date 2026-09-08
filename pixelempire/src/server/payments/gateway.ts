/** The payment-provider surface the application depends on. Keeping it as an
 *  interface means the purchase/finalization services can be tested without a
 *  network, and a second provider would not touch the ownership code. */

export interface GatewayOrder {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  amountMinor: number;
  currency: string;
  /** Provider-native status, e.g. created | authorized | captured | refunded | failed. */
  status: string;
  method?: string | null;
}

export interface PaymentGateway {
  readonly provider: string;
  createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Checkout handoff signature: HMAC(order_id|payment_id) with the API secret. */
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  /** Webhook body signature, computed over the exact raw request body. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
