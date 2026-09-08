import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const hmacSha256Hex = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

/** Constant-time comparison that does not leak length through early return. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the timing profile does not depend on length.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
