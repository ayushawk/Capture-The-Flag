/**
 * Idempotent seed (§44).
 *
 * Safe to run repeatedly against a live database: plots are inserted only when
 * missing, and the release map is re-applied only to plots that are still
 * `unreleased` or `available`. Locked, owned and disabled plots are never
 * touched, so re-seeding can never disturb a real owner.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  CHECKOUT_LOCK_MINUTES,
  FOUNDING_CURRENCY,
  FOUNDING_INVENTORY,
  FOUNDING_PRICE_MINOR,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAP,
  PLOT_STATUS,
  PLOT_TIER,
  SETTING_KEYS,
} from "../src/lib/constants";
import { foundingGridKeys } from "../src/lib/founding";

const prisma = new PrismaClient();

const FOUNDING_RULE_NAME = "Founding release";

async function seedPlots(): Promise<void> {
  const founding = foundingGridKeys(FOUNDING_INVENTORY);

  const rows: {
    gridX: number;
    gridY: number;
    status: string;
    tier: string;
  }[] = [];

  for (let gridY = 0; gridY < GRID_HEIGHT; gridY += 1) {
    for (let gridX = 0; gridX < GRID_WIDTH; gridX += 1) {
      const isFounding = founding.has(gridY * GRID_WIDTH + gridX);
      rows.push({
        gridX,
        gridY,
        status: isFounding ? PLOT_STATUS.available : PLOT_STATUS.unreleased,
        tier: isFounding ? PLOT_TIER.founding : PLOT_TIER.standard,
      });
    }
  }

  const inserted = await prisma.plot.createMany({ data: rows, skipDuplicates: true });

  // Re-apply the release map, but only where doing so cannot disturb a claim.
  const [toFounding, toUnreleased] = await Promise.all([
    prisma.$executeRaw`
      UPDATE "plots" SET "status" = 'available', "tier" = 'founding', "updated_at" = NOW()
      WHERE "status" IN ('unreleased', 'available')
        AND ("grid_y" * ${GRID_WIDTH} + "grid_x") = ANY(${[...founding]}::int[])
        AND ("status" <> 'available' OR "tier" <> 'founding')`,
    prisma.$executeRaw`
      UPDATE "plots" SET "status" = 'unreleased', "tier" = 'standard', "updated_at" = NOW()
      WHERE "status" IN ('unreleased', 'available')
        AND NOT (("grid_y" * ${GRID_WIDTH} + "grid_x") = ANY(${[...founding]}::int[]))
        AND ("status" <> 'unreleased' OR "tier" <> 'standard')`,
  ]);

  console.log(
    `plots: ${inserted.count} inserted, ${toFounding} re-released as founding, ${toUnreleased} returned to unreleased`,
  );
}

async function seedPricingRule(): Promise<void> {
  const existing = await prisma.pricingRule.findFirst({
    where: { name: FOUNDING_RULE_NAME, tier: PLOT_TIER.founding },
  });

  if (existing) {
    console.log(`pricing rule: "${FOUNDING_RULE_NAME}" already present (${existing.id})`);
    return;
  }

  const rule = await prisma.pricingRule.create({
    data: {
      name: FOUNDING_RULE_NAME,
      tier: PLOT_TIER.founding,
      priceMinor: BigInt(FOUNDING_PRICE_MINOR),
      currency: FOUNDING_CURRENCY,
      inventoryLimit: FOUNDING_INVENTORY,
      isActive: true,
    },
  });
  console.log(`pricing rule: created "${rule.name}" at ${FOUNDING_PRICE_MINOR} ${FOUNDING_CURRENCY} minor`);
}

async function seedSettings(): Promise<void> {
  const settings: [string, number][] = [
    [SETTING_KEYS.mapWidth, MAP.width],
    [SETTING_KEYS.mapHeight, MAP.height],
    [SETTING_KEYS.plotSize, MAP.plotSize],
    [SETTING_KEYS.foundingInventory, FOUNDING_INVENTORY],
    [SETTING_KEYS.foundingPrice, FOUNDING_PRICE_MINOR],
    [SETTING_KEYS.checkoutLockMinutes, CHECKOUT_LOCK_MINUTES],
  ];

  for (const [key, value] of settings) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
  console.log(`platform settings: ${settings.length} upserted`);
}

/** Optional local fixtures. Never runs unless explicitly asked for. */
async function seedDevData(): Promise<void> {
  if (process.env.SEED_DEV_DATA !== "true") return;

  const fixtures = [
    { email: "founder@example.com", name: "Aurelia", slug: "aurelia", admin: false },
    { email: "admin@example.com", name: "Cartographers Guild", slug: "cartographers-guild", admin: true },
  ];

  for (const fixture of fixtures) {
    const user = await prisma.user.upsert({
      where: { email: fixture.email },
      create: { email: fixture.email, displayName: fixture.name, isAdmin: fixture.admin },
      update: { isAdmin: fixture.admin },
    });
    await prisma.empire.upsert({
      where: { ownerUserId: user.id },
      create: {
        ownerUserId: user.id,
        name: fixture.name,
        slug: fixture.slug,
        description: "A development fixture empire.",
      },
      update: {},
    });
  }
  console.log(`dev data: ${fixtures.length} users/empires upserted`);
}

async function main(): Promise<void> {
  await seedPlots();
  await seedPricingRule();
  await seedSettings();
  await seedDevData();

  const [total, available, unreleased] = await Promise.all([
    prisma.plot.count(),
    prisma.plot.count({ where: { status: PLOT_STATUS.available } }),
    prisma.plot.count({ where: { status: PLOT_STATUS.unreleased } }),
  ]);
  console.log(`done: ${total} plots (${available} available, ${unreleased} unreleased)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
