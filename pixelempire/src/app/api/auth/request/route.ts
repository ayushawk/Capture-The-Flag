import type { NextRequest } from "next/server";
import { assertSameOrigin, clientIp, handle, json } from "@/lib/http";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";
import { requestMagicLink } from "@/server/auth/magic-link";

export const dynamic = "force-dynamic";

/** POST /api/auth/request — sends a single-use sign-in link. */
export const POST = async (request: NextRequest) =>
  handle("api.auth.request", async () => {
    assertSameOrigin(request);
    enforceRateLimit("auth", clientIp(request), RATE_LIMITS.requestLogin);

    const body = (await request.json()) as { email?: string; next?: string };
    const email = emailSchema.parse(body.email);
    // Only same-site paths may be used as a post-login destination.
    const next = typeof body.next === "string" && body.next.startsWith("/") ? body.next : undefined;

    const result = await requestMagicLink(email, next);
    // The response never reveals whether the address already had an account.
    return json({ ok: true, ...result });
  });
