import { tooManyRequests } from "./http";

/**
 * Fixed-window counter, in process memory.
 *
 * V1 ships as a single deployable service (§40), so this is sufficient and has
 * no infrastructure cost. If the app is ever scaled to multiple instances this
 * must move behind a shared store — the limit would otherwise be per-instance.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

const sweep = (now: number): void => {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
};

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Reservation attempts are the expensive, inventory-touching path. */
  createPurchase: { limit: 10, windowMs: 60_000 },
  verifyPayment: { limit: 30, windowMs: 60_000 },
  requestLogin: { limit: 5, windowMs: 15 * 60_000 },
  updateEmpire: { limit: 20, windowMs: 60_000 },
  readApi: { limit: 240, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>;

/** Throws 429 when the caller is over budget. */
export const enforceRateLimit = (bucket: string, identity: string, config: RateLimit): void => {
  const now = Date.now();
  sweep(now);
  const key = `${bucket}:${identity}`;
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }
  existing.count += 1;
  if (existing.count > config.limit) throw tooManyRequests();
};

/** Test seam. */
export const resetRateLimits = (): void => {
  windows.clear();
};
