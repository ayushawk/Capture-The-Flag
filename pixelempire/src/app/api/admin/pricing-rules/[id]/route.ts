import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handle, json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { requireAdmin } from "@/server/auth/guards";
import { updatePricingRule } from "@/server/services/admin";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    priceMinor: z.number().int().positive().max(100_000_000).optional(),
    inventoryLimit: z.number().int().positive().max(1_000_000).nullable().optional(),
    isActive: z.boolean().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

/**
 * Changes apply to future purchases only — existing purchases carry their own
 * copy of the amount, so history cannot be rewritten from here (§8).
 */
export const PATCH = async (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
  handle("api.admin.update_pricing_rule", async () => {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const input = patchSchema.parse(await request.json());
    await updatePricingRule(uuidSchema.parse(id), input, admin.id);
    return json({ ok: true });
  });
