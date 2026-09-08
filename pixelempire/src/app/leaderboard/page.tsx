import type { Metadata } from "next";
import Link from "next/link";
import { formatCount } from "@/lib/palette";
import { getLeaderboard } from "@/server/services/read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The largest empires on the PixelEmpire map, by territory held.",
};

export default async function LeaderboardPage() {
  const rows = await getLeaderboard(100);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl">Leaderboard</h1>
      <p className="mt-2 text-[--color-ink-soft]">Ranked by total logical pixels held.</p>

      {rows.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-[--color-edge] p-12 text-center text-sm text-[--color-ink-faint]">
          No territory has been claimed yet.{" "}
          <Link href="/map" className="text-[--color-gold] hover:underline">
            Be the first.
          </Link>
        </p>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-[--color-edge]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--color-edge] bg-[--color-surface-2] text-left text-xs uppercase tracking-[0.14em] text-[--color-ink-faint]">
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Empire</th>
                <th className="px-4 py-3 text-right font-medium">Plots</th>
                <th className="px-4 py-3 text-right font-medium">Pixels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.empire.id} className="border-b border-[--color-edge] bg-[--color-surface] last:border-0">
                  <td className="tabular px-4 py-3 font-mono text-[--color-ink-faint]">{row.rank}</td>
                  <td className="px-4 py-3">
                    <Link href={`/e/${row.empire.slug}`} className="font-medium hover:text-[--color-gold]">
                      {row.empire.name}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono">{formatCount(row.plots)}</td>
                  <td className="tabular px-4 py-3 text-right font-mono text-[--color-gold]">
                    {formatCount(row.pixels)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
