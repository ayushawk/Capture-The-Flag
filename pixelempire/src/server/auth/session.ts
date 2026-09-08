import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { isProduction } from "@/lib/env";

export const SESSION_COOKIE = "pe_session";
const SESSION_DAYS = 30;

/** Issues a session and sets the cookie. The raw token is never stored: the
 *  database keeps only its SHA-256, so a database leak cannot mint sessions. */
export const createSession = async (userId: string): Promise<void> => {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires: expiresAt,
  });
};

export const destroySession = async (): Promise<void> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  store.delete(SESSION_COOKIE);
};

/** Current user, or null. Expired sessions are treated as absent and cleaned up. */
export const getSessionUser = async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
};
