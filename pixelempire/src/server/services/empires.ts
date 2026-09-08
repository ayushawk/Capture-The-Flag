import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { ACTIVITY_EVENT } from "@/lib/constants";
import { badRequest, conflict, notFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { RESERVED_SLUGS, cleanText, slugify, type UpdateEmpireInput } from "@/lib/validation";

const UNIQUE_VIOLATION = "P2002";

/** A readable empire name derived from an email local part. */
const nameFromEmail = (email: string): string => {
  const local = email.split("@")[0] ?? "empire";
  const words = cleanText(local.replace(/[._-]+/g, " "))
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const name = words.join(" ").slice(0, 40);
  return name.length >= 2 ? name : "New Empire";
};

/** Finds a free slug near `base`, falling back to a numeric suffix. */
export const uniqueSlug = async (tx: Tx, base: string, excludeEmpireId?: string): Promise<string> => {
  const root = slugify(base) || "empire";
  const candidates = [root, ...Array.from({ length: 40 }, (_, i) => `${root}-${i + 2}`)];

  for (const candidate of candidates) {
    if (RESERVED_SLUGS.has(candidate)) continue;
    const existing = await tx.empire.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeEmpireId) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Finds or creates the user and their single primary empire (§5).
 *
 * Every user has an empire from the moment they sign in, which is what lets
 * finalizePurchase() always have an `owner_empire_id` to assign. The empire is
 * customised later in the flow (§29).
 */
export const ensureUserWithEmpire = async (email: string) => {
  const existing = await prisma.user.findUnique({ where: { email }, include: { empire: true } });
  if (existing?.empire) return { user: existing, empire: existing.empire, created: false as const };

  return prisma.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({ data: { email, displayName: nameFromEmail(email) } }));

    const name = nameFromEmail(email);
    const slug = await uniqueSlug(tx, name);
    const empire = await tx.empire.create({ data: { ownerUserId: user.id, name, slug } });

    await tx.activityEvent.create({
      data: {
        eventType: ACTIVITY_EVENT.empireCreated,
        userId: user.id,
        empireId: empire.id,
        metadata: { name: empire.name, slug: empire.slug },
      },
    });

    logger.info("empire.created", { userId: user.id, empireId: empire.id, slug: empire.slug });
    return { user, empire, created: true as const };
  });
};

/** The user's primary empire, created on demand if it is somehow missing. */
export const primaryEmpireFor = async (tx: Tx, userId: string) => {
  const empire = await tx.empire.findUnique({ where: { ownerUserId: userId } });
  if (empire) return empire;

  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");

  const name = nameFromEmail(user.email);
  const slug = await uniqueSlug(tx, name);
  return tx.empire.create({ data: { ownerUserId: userId, name, slug } });
};

export const updateEmpire = async (userId: string, input: UpdateEmpireInput) => {
  const empire = await prisma.empire.findUnique({ where: { ownerUserId: userId } });
  if (!empire) throw notFound("You do not have an empire yet");

  const data: Prisma.EmpireUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;
  if (input.xUsername !== undefined) data.xUsername = input.xUsername;
  if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl;
  if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;

  if (Object.keys(data).length === 0) throw badRequest("nothing_to_update", "Nothing to update");

  try {
    const updated = await prisma.empire.update({ where: { id: empire.id }, data });
    logger.info("empire.updated", { userId, empireId: empire.id, fields: Object.keys(data) });
    return updated;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw conflict("slug_taken", "That address is already taken");
    }
    throw error;
  }
};
