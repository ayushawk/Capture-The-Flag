import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { consumeMagicLink } from "@/server/auth/magic-link";

export const dynamic = "force-dynamic";

/** GET /api/auth/callback?token=&next= — consumes the link and redirects. */
export const GET = async (request: NextRequest) => {
  const token = request.nextUrl.searchParams.get("token");
  const nextParam = request.nextUrl.searchParams.get("next");
  // Open-redirect guard: only same-site paths are honoured.
  const destination = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : "/map";

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", env.appUrl));
  }

  try {
    await consumeMagicLink(token);
    return NextResponse.redirect(new URL(destination, env.appUrl));
  } catch (error) {
    logger.info("auth.callback_rejected", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.redirect(new URL("/login?error=invalid_link", env.appUrl));
  }
};
