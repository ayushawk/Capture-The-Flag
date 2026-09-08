import type { Metadata } from "next";
import { redirect } from "next/navigation";
import EmpireEditor from "@/components/EmpireEditor";
import { prisma } from "@/lib/db";
import { PIXELS_PER_PLOT, PLOT_STATUS } from "@/lib/constants";
import { formatCount } from "@/lib/palette";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your empire" };

export default async function EmpireSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/empire");

  const empire = await prisma.empire.findUnique({ where: { ownerUserId: user.id } });
  if (!empire) redirect("/map");

  const plots = await prisma.plot.count({
    where: { ownerEmpireId: empire.id, status: PLOT_STATUS.owned },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-display text-4xl">Your empire</h1>
      <p className="mt-2 text-[--color-ink-soft]">
        {plots === 0
          ? "You have not claimed any land yet — set your name now so it is ready when you do."
          : `${formatCount(plots)} plot${plots === 1 ? "" : "s"} · ${formatCount(plots * PIXELS_PER_PLOT)} pixels`}
      </p>
      <EmpireEditor
        empire={{
          name: empire.name,
          slug: empire.slug,
          description: empire.description,
          xUsername: empire.xUsername,
          websiteUrl: empire.websiteUrl,
          avatarUrl: empire.avatarUrl,
        }}
      />
    </main>
  );
}
