import type { NextRequest } from "next/server";
import { assertSameOrigin, handle, json } from "@/lib/http";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { updateEmpireSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/guards";
import { updateEmpire } from "@/server/services/empires";

export const dynamic = "force-dynamic";

/** PATCH /api/me/empire — customise the signed-in user's empire. */
export const PATCH = async (request: NextRequest) =>
  handle("api.me.empire", async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit("empire", user.id, RATE_LIMITS.updateEmpire);

    const input = updateEmpireSchema.parse(await request.json());
    const empire = await updateEmpire(user.id, input);

    return json({
      empire: {
        id: empire.id,
        name: empire.name,
        slug: empire.slug,
        description: empire.description,
        xUsername: empire.xUsername,
        websiteUrl: empire.websiteUrl,
        avatarUrl: empire.avatarUrl,
      },
    });
  });
