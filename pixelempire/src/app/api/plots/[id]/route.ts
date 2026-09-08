import { handle, json } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";
import { getPlotDetail } from "@/server/services/read";

export const dynamic = "force-dynamic";

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) =>
  handle("api.plot", async () => {
    const { id } = await context.params;
    return json(await getPlotDetail(uuidSchema.parse(id)));
  });
