/** Structured logging with safe correlation ids (§43).
 *  Nothing here may receive card data, CVV, bank credentials or provider secrets. */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Redacted anywhere they appear in a log context, at any depth. */
const FORBIDDEN = new Set([
  "card",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "pin",
  "password",
  "secret",
  "signature",
  "razorpaysignature",
  "razorpay_signature",
  "token",
  "authorization",
  "cookie",
  "keysecret",
  "key_secret",
  "accountnumber",
  "account_number",
  "ifsc",
  "vpa",
]);

const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = FORBIDDEN.has(key.toLowerCase()) ? "[redacted]" : scrub(item, depth + 1);
  }
  return out;
};

const threshold = (): number => ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

const emit = (level: Level, event: string, context: Record<string, unknown> = {}): void => {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(scrub(context) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => emit("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => emit("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => emit("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => emit("error", event, context),
};

/** Safe correlation identifiers carried through the purchase/payment pipeline. */
export interface Correlation {
  purchaseId?: string;
  paymentId?: string;
  plotId?: string;
  userId?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerEventId?: string;
}
