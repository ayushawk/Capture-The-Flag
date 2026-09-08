import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { forbidden, handle, json } from "@/lib/http";
import { safeEqual } from "@/lib/crypto";
import { expireDueLocks } from "@/server/services/expire-locks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cron/expire-locks — the §18 sweeper, for hosts that provide a
 * scheduler rather than a long-lived worker. Same service either way.
 */
export const POST = async (request: NextRequest) =>
  handle("api.cron.expire_locks", async () => {
    const secret = env.cronSecret;
    if (!secret) throw forbidden("Scheduled sweeps are not configured");

    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!safeEqual(secret, provided)) throw forbidden("Invalid cron credentials");

    return json(await expireDueLocks());
  });

export const GET = POST;
