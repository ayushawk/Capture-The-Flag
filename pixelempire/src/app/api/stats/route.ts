import { handle, json } from "@/lib/http";
import { getStats } from "@/server/services/read";
import { publicPricing } from "@/server/services/pricing";
import { PLOT_TIER } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const GET = async () =>
  handle("api.stats", async () => {
    const [stats, pricing] = await Promise.all([getStats(), publicPricing(PLOT_TIER.founding)]);
    return json(
      { ...stats, pricing },
      { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=60" } },
    );
  });
