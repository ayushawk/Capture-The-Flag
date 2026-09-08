import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { limitSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { adminExceptions } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** Paid transactions that could not become ownership, awaiting a refund. */
export const GET = async (request: NextRequest) =>
  handle("api.admin.exceptions", async () => {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const limit = limitSchema(50, 200).parse(params.get("limit") ?? undefined);
    return json({
      exceptions: await adminExceptions(limit, params.get("includeResolved") === "true"),
    });
  });
