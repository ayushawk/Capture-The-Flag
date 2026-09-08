import { execSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Applies migrations and the seed to the test database once per run, so the
 * suite exercises the same schema, constraints and triggers as production.
 */
export default function setup(): void {
  config({ path: ".env.test", override: true });

  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL! };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
