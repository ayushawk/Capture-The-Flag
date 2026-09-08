import Link from "next/link";
import MapPreview from "@/components/MapPreview";
import StatGrid from "@/components/StatGrid";
import { formatCount, formatMoney } from "@/lib/palette";
import { PLOT_TIER } from "@/lib/constants";
import { publicPricing } from "@/server/services/pricing";
import { getActivity, getLeaderboard, getStats } from "@/server/services/read";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [stats, pricing, leaders, activity] = await Promise.all([
    getStats(),
    publicPricing(PLOT_TIER.founding),
    getLeaderboard(5),
    getActivity(6),
  ]);

  const price = pricing ? formatMoney(pricing.priceMinor, pricing.currency) : "$1";

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24">
      {/* ---------------------------------------------------------- hero */}
      <section className="pt-16 sm:pt-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[--color-gold-deep] bg-[rgba(245,181,61,0.08)] px-3 py-1 text-xs font-medium text-[--color-gold]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[--color-gold]" />
          Founding release · {formatCount(stats.availablePlots)} of {formatCount(stats.foundingPlots)} plots left
        </p>

        <h1 className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
          Own a piece
          <br />
          of the internet.
        </h1>

        <p className="mt-6 max-w-xl text-lg text-[--color-ink-soft]">
          PixelEmpire is one shared map of a million pixels. Claim a 10×10 plot for {price}, name your
          empire, and hold your corner of it in public — on the map, on the leaderboard, forever
          attached to your name.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/map"
            className="rounded-xl bg-[--color-gold] px-6 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft]"
          >
            Claim your territory
          </Link>
          <Link
            href="#how"
            className="rounded-xl border border-[--color-edge] px-6 py-3 font-medium text-[--color-ink-soft] transition hover:border-[--color-edge-bright] hover:text-[--color-ink]"
          >
            How it works
          </Link>
        </div>
      </section>

      {/* --------------------------------------------------------- stats */}
      <section className="mt-14">
        <StatGrid stats={stats} />
      </section>

      {/* ----------------------------------------------------------- map */}
      <section className="mt-14">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">The world</h2>
            <p className="mt-1 text-sm text-[--color-ink-soft]">
              Gold is founding land, on sale now. Coloured plots belong to an empire. Everything grey is
              unreleased.
            </p>
          </div>
          <Link href="/map" className="shrink-0 text-sm text-[--color-gold] hover:underline">
            Open full map →
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-void]">
          <MapPreview />
        </div>
      </section>

      {/* --------------------------------------------------- how it works */}
      <section id="how" className="mt-20 scroll-mt-20">
        <h2 className="font-display text-2xl">How it works</h2>
        <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-edge] sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: "01", t: "Find a plot", d: "Explore the map and pick an unclaimed square of founding land." },
            { n: "02", t: "Reserve it", d: `It is held for you for ten minutes while you pay ${price}.` },
            { n: "03", t: "Own it", d: "Once payment clears, the plot is yours and shows your empire." },
            { n: "04", t: "Share it", d: "Name your empire, get a public page, and post it on X." },
          ].map((step) => (
            <li key={step.n} className="bg-[--color-surface] p-6">
              <span className="font-mono text-xs text-[--color-gold]">{step.n}</span>
              <h3 className="mt-2 font-semibold">{step.t}</h3>
              <p className="mt-1.5 text-sm text-[--color-ink-soft]">{step.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------ leaderboard + activity */}
      <section className="mt-20 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-display text-2xl">Largest empires</h2>
            <Link href="/leaderboard" className="text-sm text-[--color-gold] hover:underline">
              Full leaderboard →
            </Link>
          </div>
          {leaders.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[--color-edge] p-8 text-center text-sm text-[--color-ink-faint]">
              No empire has claimed land yet. The first one on the board will be hard to forget.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-[--color-edge]">
              {leaders.map((row) => (
                <li
                  key={row.empire.id}
                  className="flex items-center justify-between border-b border-[--color-edge] bg-[--color-surface] px-4 py-3 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="tabular w-6 font-mono text-sm text-[--color-ink-faint]">{row.rank}</span>
                    <Link href={`/e/${row.empire.slug}`} className="truncate font-medium hover:text-[--color-gold]">
                      {row.empire.name}
                    </Link>
                  </div>
                  <span className="tabular shrink-0 font-mono text-sm text-[--color-ink-soft]">
                    {formatCount(row.pixels)} px
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-4 font-display text-2xl">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[--color-edge] p-8 text-center text-sm text-[--color-ink-faint]">
              Nothing has happened yet. Go first.
            </p>
          ) : (
            <ul className="space-y-2">
              {activity.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[--color-edge] bg-[--color-surface] px-4 py-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {event.type === "territory_claimed" && event.plot ? (
                      <>
                        <strong className="font-medium">{event.empire?.name ?? "An empire"}</strong> claimed
                        territory at{" "}
                        <span className="tabular font-mono text-[--color-gold]">
                          {event.plot.gridX},{event.plot.gridY}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong className="font-medium">{event.empire?.name ?? "An empire"}</strong> was founded
                      </>
                    )}
                  </span>
                  <time
                    dateTime={event.createdAt}
                    className="shrink-0 text-xs text-[--color-ink-faint]"
                  >
                    {new Date(event.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- faq */}
      <section className="mt-20">
        <h2 className="font-display text-2xl">Questions</h2>
        <div className="mt-6 divide-y divide-[--color-edge] overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-surface]">
          {[
            {
              q: "What exactly am I buying?",
              a: `A ${price} claim on one 10×10 plot of the PixelEmpire map, held under your empire's name and shown publicly on the map, your empire page and the leaderboard.`,
            },
            {
              q: "Is this an investment?",
              a: "No. A plot is a novelty and a place to plant your flag — nothing more. It is not a financial product, it will not pay you anything, and you should not expect it to be worth money later. Buy one because you want the square, not because you expect a return.",
            },
            {
              q: "How much land is there?",
              a: `The map is 1,000 × 1,000 logical pixels — 10,000 plots in total. Only ${formatCount(stats.foundingPlots)} are in the founding release; the rest are unreleased.`,
            },
            {
              q: "What happens if two people claim the same plot?",
              a: "The first reservation to reach the server wins and holds the plot for ten minutes. Everyone else sees it as taken. If the payment never lands, the plot goes back on the map automatically.",
            },
            {
              q: "What if my payment succeeds but something goes wrong?",
              a: "Ownership is written server-side after the payment is verified with the provider, so a closed browser or a flaky connection does not lose your plot. If a plot genuinely cannot be given to you, the payment is routed for a refund rather than silently kept.",
            },
            {
              q: "Can I sell or trade my plot?",
              a: "Not in this version. There is no marketplace, no resale, no auctions and no crypto involved.",
            },
          ].map((item) => (
            <details key={item.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {item.q}
                <span className="ml-4 text-[--color-ink-faint] transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[--color-ink-soft]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- closing */}
      <section className="mt-20 rounded-2xl border border-[--color-edge] bg-[--color-surface] p-10 text-center">
        <h2 className="font-display text-3xl">There is only one map.</h2>
        <p className="mx-auto mt-3 max-w-md text-[--color-ink-soft]">
          {formatCount(stats.availablePlots)} founding plots are still unclaimed.
        </p>
        <Link
          href="/map"
          className="mt-6 inline-block rounded-xl bg-[--color-gold] px-6 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft]"
        >
          Claim your territory
        </Link>
      </section>

      <footer className="mt-16 border-t border-[--color-edge] pt-8 text-xs text-[--color-ink-faint]">
        <p>
          PixelEmpire is a public map, not a financial product. Plots are not investments, securities or
          collectible assets, and no return of any kind is offered or implied.
        </p>
      </footer>
    </main>
  );
}
