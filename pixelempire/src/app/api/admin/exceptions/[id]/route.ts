import type { NextRequest } from "next/server";
import { assertSameOrigin, handle, json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { resolveException } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** POST /api/admin/exceptions/:id — mark a refund/exception case handled. */
export const POST = async (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  handle("api.admin.resolve_exception", async () => {
    assertSameOrigin(request);
    await requireAdmin();
    const { id } = await context.params;
    await resolveException(uuidSchema.parse(id));
    return json({ ok: true });
  });
