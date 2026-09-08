import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShareRow from "@/components/ShareRow";
import TerritoryMap from "@/components/TerritoryMap";
import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/palette";
import { getPublicEmpire } from "@/server/services/read";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const load = async (slug: string) => {
  try {
    return await getPublicEmpire(slug);
  } catch {
    return null;
  }
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const empire = await load(slug);
  if (!empire) return { title: "Empire not found" };

  const description =
    empire.description ??
    `${empire.name} holds ${formatCount(empire.plots)} plot${empire.plots === 1 ? "" : "s"} — ${formatCount(empire.pixels)} pixels of the PixelEmpire map.`;

  return {
    title: empire.name,
    description,
    openGraph: { title: `${empire.name} · PixelEmpire`, description, type: "profile" },
    twitter: { card: "summary_large_image", title: `${empire.name} · PixelEmpire`, description },
  };
}

export default async function EmpirePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [empire, user] = await Promise.all([load(slug), getSessionUser()]);
  if (!empire) notFound();

  // The edit link only shows on your own empire. Ownership is checked against
  // the session's empire rather than exposing owner ids in the public payload.
  const viewerEmpire = user
    ? await prisma.empire.findUnique({ where: { ownerUserId: user.id }, select: { id: true } })
    : null;
  const isOwner = viewerEmpire?.id === empire.id;

  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <div className="grid gap-8 md:grid-cols-[1fr_260px]">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[--color-ink-faint]">Empire</p>
          <h1 className="mt-1 font-display text-4xl leading-tight sm:text-5xl">{empire.name}</h1>

          {empire.description && (
            <p className="mt-4 max-w-xl text-[--color-ink-soft]">{empire.description}</p>
          )}

          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            {empire.xUsername && (
              <a
                href={`https://x.com/${empire.xUsername}`}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-[--color-claimed-soft] hover:underline"
              >
                @{empire.xUsername}
              </a>
            )}
            {empire.websiteUrl && (
              <a
                href={empire.websiteUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-[--color-claimed-soft] hover:underline"
              >
                {new URL(empire.websiteUrl).hostname}
              </a>
            )}
          </div>

          <dl className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-edge]">
            <Stat label="Plots" value={formatCount(empire.plots)} />
            <Stat label="Pixels" value={formatCount(empire.pixels)} />
            <Stat label="Rank" value={empire.rank ? `#${empire.rank}` : "—"} />
          </dl>

          <ShareRow className="mt-6" slug={empire.slug} />
        </div>

        <aside>
          <div className="overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-void]">
            <TerritoryMap
              empireId={empire.id}
              territories={empire.territories}
              className="block h-auto w-full"
            />
          </div>
          <p className="mt-2 text-center text-xs text-[--color-ink-faint]">Position on the world map</p>
          {isOwner && (
            <Link
              href="/empire"
              className="mt-4 block rounded-xl border border-[--color-edge] px-4 py-2 text-center text-sm hover:border-[--color-edge-bright]"
            >
              Edit your empire
            </Link>
          )}
        </aside>
      </div>

      <section className="mt-14">
        <h2 className="font-display text-2xl">Territories</h2>
        {empire.territories.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-[--color-edge] p-10 text-center text-sm text-[--color-ink-faint]">
            This empire has not claimed any land yet.
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {empire.territories.map((plot) => (
              <li key={plot.id}>
                <Link
                  href={`/map?x=${plot.gridX}&y=${plot.gridY}`}
                  className="tabular block rounded-lg border border-[--color-edge] bg-[--color-surface] px-3 py-1.5 font-mono text-sm hover:border-[--color-gold] hover:text-[--color-gold]"
                >
                  {plot.gridX}, {plot.gridY}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[--color-surface] px-4 py-5">
      <dt className="text-xs uppercase tracking-[0.16em] text-[--color-ink-faint]">{label}</dt>
      <dd className="tabular mt-1 font-mono text-2xl font-semibold">{value}</dd>
    </div>
  );
}
