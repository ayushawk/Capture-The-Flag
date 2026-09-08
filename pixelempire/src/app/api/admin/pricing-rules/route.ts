import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, handle, json } from "@/lib/http";
import { requireAdmin } from "@/server/auth/guards";
import { createPricingRule, listPricingRules } from "@/server/services/admin";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  tier: z.string().trim().min(2).max(40),
  priceMinor: z.number().int().positive().max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase(),
  inventoryLimit: z.number().int().positive().max(1_000_000).nullable().default(null),
  isActive: z.boolean().default(false),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
});

export const GET = async () =>
  handle("api.admin.pricing_rules", async () => {
    await requireAdmin();
    return json({ rules: await listPricingRules() });
  });

export const POST = async (request: NextRequest) =>
  handle("api.admin.create_pricing_rule", async () => {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = createSchema.parse(await request.json());
    const id = await createPricingRule(input, admin.id);
    return json({ id }, { status: 201 });
  });
