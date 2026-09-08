import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { badRequest } from "@/lib/http";
import { logger } from "@/lib/logger";
import { ensureUserWithEmpire } from "@/server/services/empires";
import { createSession } from "./session";

const TOKEN_TTL_MINUTES = 15;

/**
 * Issues a single-use magic link.
 *
 * The response to the caller is deliberately identical whether or not the email
 * is already registered, so this endpoint cannot be used to enumerate accounts.
 */
export const requestMagicLink = async (email: string, redirectTo?: string): Promise<{ devLink?: string }> => {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

  await prisma.loginToken.create({ data: { email, tokenHash: sha256Hex(token), expiresAt } });

  const url = new URL("/api/auth/callback", env.appUrl);
  url.searchParams.set("token", token);
  if (redirectTo) url.searchParams.set("next", redirectTo);
  const link = url.toString();

  await sendEmail({
    to: email,
    subject: `Sign in to ${env.appName}`,
    text: `Sign in to ${env.appName}:\n\n${link}\n\nThis link expires in ${TOKEN_TTL_MINUTES} minutes and can be used once.\nIf you did not request it, you can ignore this email.`,
    html: `<p>Sign in to <strong>${env.appName}</strong>:</p><p><a href="${link}">Claim your territory</a></p><p>This link expires in ${TOKEN_TTL_MINUTES} minutes and can be used once.</p>`,
  });

  logger.info("auth.magic_link_requested", { expiresAt: expiresAt.toISOString() });

  // Development convenience only: never leak the link in production.
  return env.emailProvider === "console" ? { devLink: link } : {};
};

/** Consumes a magic-link token and starts a session. Single use, enforced by
 *  an atomic conditional update rather than a read-then-write. */
export const consumeMagicLink = async (token: string): Promise<{ userId: string; slug: string }> => {
  const tokenHash = sha256Hex(token);

  const consumed = await prisma.loginToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw badRequest("invalid_login_link", "That sign-in link has expired or was already used");
  }

  const record = await prisma.loginToken.findUnique({ where: { tokenHash } });
  if (!record) throw badRequest("invalid_login_link", "That sign-in link is not valid");

  const { user, empire } = await ensureUserWithEmpire(record.email);
  await createSession(user.id);

  // Housekeeping: drop this address's other outstanding links.
  await prisma.loginToken.deleteMany({
    where: { email: record.email, consumedAt: null },
  });

  logger.info("auth.signed_in", { userId: user.id });
  return { userId: user.id, slug: empire.slug };
};
