import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { processRazorpayWebhook } from "@/server/services/webhook";

export const dynamic = "force-dynamic";
// The signature is computed over the exact bytes Razorpay sent, so the body
// must be read raw — never re-serialised from a parsed object.
export const runtime = "nodejs";

/**
 * POST /api/webhooks/razorpay (§15).
 *
 * No session and no CSRF check: this is server-to-server and is authenticated
 * by its signature alone. Processing is idempotent, because the same event will
 * arrive more than once.
 */
export const POST = async (request: NextRequest) =>
  handle("api.webhooks.razorpay", async () => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");
    const eventId = request.headers.get("x-razorpay-event-id");

    const result = await processRazorpayWebhook(rawBody, signature, eventId);
    // Always 200 once the signature is good: a non-2xx makes Razorpay retry,
    // and there is nothing to gain from replaying an event we understood.
    return json({ ok: true, ...result });
  });
