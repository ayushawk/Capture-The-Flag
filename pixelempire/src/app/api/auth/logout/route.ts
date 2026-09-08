import type { NextRequest } from "next/server";
import { assertSameOrigin, handle, json } from "@/lib/http";
import { destroySession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest) =>
  handle("api.auth.logout", async () => {
    assertSameOrigin(request);
    await destroySession();
    return json({ ok: true });
  });
