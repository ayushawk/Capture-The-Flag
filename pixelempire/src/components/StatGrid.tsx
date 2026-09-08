import { formatCount, formatMoney } from "@/lib/palette";
import type { PlatformStats } from "@/server/services/read";

/** The live counts from §2. Rendered on the server so they are in the HTML. */
export default function StatGrid({ stats }: { stats: PlatformStats }) {
  const items = [
    { label: "Map pixels", value: formatCount(stats.totalPixels) },
    { label: "Founding land", value: `${formatCount(stats.foundingPixels)} px` },
    { label: "Claimed land", value: `${formatCount(stats.claimedPixels)} px` },
    { label: "Empires", value: formatCount(stats.empires) },
    { label: "Total spent", value: formatMoney(stats.totalSpentMinor, stats.currency) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-edge] sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-[--color-surface] px-4 py-5">
          <dt className="text-xs uppercase tracking-[0.16em] text-[--color-ink-faint]">{item.label}</dt>
          <dd className="tabular mt-1.5 font-mono text-xl font-semibold text-[--color-ink] sm:text-2xl">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
