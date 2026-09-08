import type { User } from "@prisma/client";
import { forbidden, unauthorized } from "@/lib/http";
import { getSessionUser } from "./session";

export const requireUser = async (): Promise<User> => {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
};

/**
 * Admin authorization is enforced here, on the server, for every admin route
 * (§24). Hiding admin UI is never the control.
 */
export const requireAdmin = async (): Promise<User> => {
  const user = await requireUser();
  if (!user.isAdmin) throw forbidden("Administrator access required");
  return user;
};
