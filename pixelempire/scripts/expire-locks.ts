/**
 * Lock expiration worker (§18).
 *
 * Two ways to run it:
 *   npm run worker:locks            one sweep, then exit (cron / Kubernetes Job)
 *   npm run worker:locks -- --loop  sweep every 60s until stopped (long-lived process)
 *
 * Hosts with a scheduler instead of a worker can call
 * POST /api/cron/expire-locks with the CRON_SECRET; see vercel.json.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { expireDueLocks } from "../src/server/services/expire-locks";

const INTERVAL_MS = 60_000;
const loop = process.argv.includes("--loop");

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const sweep = async (): Promise<void> => {
  const result = await expireDueLocks();
  if (result.scanned > 0) {
    console.log(
      `swept ${result.scanned}: ${result.locksReleased} locks released, ` +
        `${result.purchasesExpired} purchases expired, ${result.plotsReleased} plots back on sale` +
        (result.skipped ? `, ${result.skipped} skipped` : ""),
    );
  }
};

const main = async (): Promise<void> => {
  if (!loop) {
    await sweep();
    return;
  }
  console.log(`lock worker started; sweeping every ${INTERVAL_MS / 1000}s`);
  while (!stopping) {
    try {
      await sweep();
    } catch (error) {
      console.error("sweep failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  console.log("lock worker stopped");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
