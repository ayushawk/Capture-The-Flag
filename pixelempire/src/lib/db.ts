import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Prisma transaction client — the type accepted by every service that must
 *  run inside the caller's transaction. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** BigInt does not survive JSON.stringify; amounts are minor units well inside
 *  Number.MAX_SAFE_INTEGER, so narrowing at the edge is safe. */
export const toNumber = (value: bigint | number): number =>
  typeof value === "bigint" ? Number(value) : value;
