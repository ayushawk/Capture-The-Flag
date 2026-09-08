import { NextResponse } from "next/server";
import { logger } from "./logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Stable machine-readable code the UI switches on for §42 error states. */
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = "Sign in to continue") =>
  new ApiError(401, "unauthenticated", message);
export const forbidden = (message = "You do not have access to this") =>
  new ApiError(403, "forbidden", message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(409, code, message, details);
export const tooManyRequests = (message = "Too many requests. Please slow down.") =>
  new ApiError(429, "rate_limited", message);

export const json = <T>(data: T, init?: ResponseInit): NextResponse =>
  NextResponse.json(data as object, init);

/** Wraps a route handler so thrown ApiErrors become clean JSON and anything
 *  else becomes a 500 without leaking internals to the client. */
export const handle = async (
  event: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status >= 500) logger.error(`${event}.error`, { code: error.code, message: error.message });
      else logger.info(`${event}.rejected`, { code: error.code, status: error.status });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
        { status: error.status },
      );
    }
    logger.error(`${event}.unhandled`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: { code: "server_error", message: "Something went wrong on our side." } },
      { status: 500 },
    );
  }
};

/**
 * CSRF defence for cookie-authenticated mutations: the browser always sends
 * Origin on cross-site POSTs, and a cross-site attacker cannot forge it.
 * Combined with SameSite=Lax session cookies this covers §36.
 * Webhooks are exempt — they carry no cookie and are signature-verified.
 */
export const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Non-browser client (curl, server-to-server). Cookies would not be
    // attached cross-site by a browser without an Origin, so allow it.
    return;
  }
  const host = request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Invalid request origin");
  }
  if (!host || originHost !== host) {
    throw forbidden("Cross-origin request rejected");
  }
};

export const clientIp = (request: Request): string => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
};
