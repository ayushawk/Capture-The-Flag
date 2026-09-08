import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/http";
import { limitSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { adminUsers } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) =>
  handle("api.admin.users", async () => {
    await requireAdmin();
    const limit = limitSchema(50, 200).parse(request.nextUrl.searchParams.get("limit") ?? undefined);
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    return json({ users: await adminUsers(limit, cursor) });
  });
