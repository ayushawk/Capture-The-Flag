import { handle, json } from "@/lib/http";
import { requireAdmin } from "@/server/auth/guards";
import { adminStats } from "@/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = async () =>
  handle("api.admin.stats", async () => {
    await requireAdmin();
    return json(await adminStats());
  });
