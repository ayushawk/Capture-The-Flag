import { handle, json } from "@/lib/http";
import { getPublicEmpire } from "@/server/services/read";

export const dynamic = "force-dynamic";

export const GET = async (_request: Request, context: { params: Promise<{ slug: string }> }) =>
  handle("api.empire", async () => {
    const { slug } = await context.params;
    return json(await getPublicEmpire(slug));
  });
