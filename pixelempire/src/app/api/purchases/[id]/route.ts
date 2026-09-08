import { handle, json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/guards";
import { purchaseStatusFor } from "@/server/services/purchases";

export const dynamic = "force-dynamic";

/** GET /api/purchases/:id — reservation state, polled by the checkout screen. */
export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) =>
  handle("api.purchases.get", async () => {
    const user = await requireUser();
    const { id } = await context.params;
    return json(await purchaseStatusFor(user.id, uuidSchema.parse(id)));
  });
