import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ACTIVITY_EVENT, PIXELS_PER_PLOT } from "@/lib/constants";
import { updateEmpireSchema } from "@/lib/validation";
import { ensureUserWithEmpire, updateEmpire } from "@/server/services/empires";
import { createPurchase } from "@/server/services/purchases";
import { verifyAndFinalize } from "@/server/services/verify-payment";
import { getActivity, getLeaderboard, getPublicEmpire, getStats } from "@/server/services/read";
import { availablePlot, makeFakeGateway, resetDynamicData } from "./helpers";

describe("empires (§5, §23)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("gives a new user exactly one empire on first sign-in", async () => {
    const first = await ensureUserWithEmpire("ada@example.test");
    expect(first.created).toBe(true);
    expect(first.empire.name).toBe("Ada");
    expect(first.empire.slug).toBe("ada");

    const again = await ensureUserWithEmpire("ada@example.test");
    expect(again.created).toBe(false);
    expect(again.empire.id).toBe(first.empire.id);

    // One user, one empire — V1 allows no more (§5).
    expect(await prisma.empire.count({ where: { ownerUserId: first.user.id } })).toBe(1);
    await expect(
      prisma.empire.create({
        data: { ownerUserId: first.user.id, name: "Second", slug: "second-empire" },
      }),
    ).rejects.toThrow();
  });

  it("records an empire_created activity event", async () => {
    const { empire } = await ensureUserWithEmpire("grace@example.test");
    const events = await prisma.activityEvent.findMany({ where: { empireId: empire.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe(ACTIVITY_EVENT.empireCreated);
  });

  it("gives colliding names distinct slugs", async () => {
    const first = await ensureUserWithEmpire("ada@one.test");
    const second = await ensureUserWithEmpire("ada@two.test");
    expect(first.empire.slug).toBe("ada");
    expect(second.empire.slug).toBe("ada-2");
  });

  it("saves a customised empire and rejects a taken address", async () => {
    const owner = await ensureUserWithEmpire("owner@example.test");
    const other = await ensureUserWithEmpire("other@example.test");

    const input = updateEmpireSchema.parse({
      name: "The Gilded Reach",
      slug: "gilded-reach",
      description: "  A small, tidy corner.  ",
      xUsername: "@gildedreach",
      websiteUrl: "gilded.example.com",
    });
    const updated = await updateEmpire(owner.user.id, input);

    expect(updated.name).toBe("The Gilded Reach");
    expect(updated.slug).toBe("gilded-reach");
    expect(updated.description).toBe("A small, tidy corner.");
    expect(updated.xUsername).toBe("gildedreach");
    expect(updated.websiteUrl).toBe("https://gilded.example.com/");

    await expect(
      updateEmpire(other.user.id, updateEmpireSchema.parse({ slug: "gilded-reach" })),
    ).rejects.toMatchObject({ code: "slug_taken" });
  });
});

describe("public reads (§22, §31)", () => {
  beforeEach(async () => {
    await resetDynamicData();
  });

  it("ranks empires by pixels held and reflects a claim everywhere", async () => {
    const { user, empire } = await ensureUserWithEmpire("holder@example.test");
    const plot = await availablePlot();
    const fake = makeFakeGateway();

    const reservation = await createPurchase(user.id, plot.id, fake.gateway);
    const payment = fake.pay(reservation.razorpayOrderId);
    await verifyAndFinalize(
      {
        userId: user.id,
        purchaseId: reservation.purchaseId,
        razorpayOrderId: reservation.razorpayOrderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: fake.sign(reservation.razorpayOrderId, payment.id),
      },
      fake.gateway,
    );

    const [leaderboard, profile, stats, activity] = await Promise.all([
      getLeaderboard(10),
      getPublicEmpire(empire.slug),
      getStats(),
      getActivity(10),
    ]);

    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toMatchObject({ rank: 1, plots: 1, pixels: PIXELS_PER_PLOT });

    expect(profile.plots).toBe(1);
    expect(profile.pixels).toBe(PIXELS_PER_PLOT);
    expect(profile.rank).toBe(1);
    expect(profile.territories).toHaveLength(1);

    expect(stats.claimedPlots).toBe(1);
    expect(stats.claimedPixels).toBe(PIXELS_PER_PLOT);
    expect(stats.empires).toBe(1);
    // $1.00 in minor units, taken from the completed purchase.
    expect(stats.totalSpentMinor).toBe(100);

    expect(activity[0]).toMatchObject({ type: ACTIVITY_EVENT.territoryClaimed });
  });

  it("keeps private user data out of the public empire payload", async () => {
    const { empire } = await ensureUserWithEmpire("private@example.test");
    const profile = await getPublicEmpire(empire.slug);
    const serialised = JSON.stringify(profile);
    expect(serialised).not.toContain("private@example.test");
    expect(serialised).not.toContain("ownerUserId");
  });

  it("404s for an unknown empire", async () => {
    await expect(getPublicEmpire("nobody-here")).rejects.toMatchObject({ status: 404 });
  });
});
