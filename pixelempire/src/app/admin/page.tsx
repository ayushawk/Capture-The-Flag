import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlotToggle, PricingToggle, ResolveException } from "@/components/AdminActions";
import { formatCount, formatMoney } from "@/lib/palette";
import { getSessionUser } from "@/server/auth/session";
import {
  adminExceptions,
  adminPayments,
  adminPlots,
  adminPurchases,
  adminStats,
  listPricingRules,
} from "@/server/services/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await getSessionUser();
  // Not a redirect: an unauthorised visitor should not learn this page exists.
  if (!user?.isAdmin) notFound();

  const [stats, exceptions, purchases, payments, lockedPlots, rules] = await Promise.all([
    adminStats(),
    adminExceptions(20, false),
    adminPurchases({ limit: 15 }),
    adminPayments({ limit: 15 }),
    adminPlots({ status: "locked", limit: 20 }),
    listPricingRules(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-display text-3xl">Admin</h1>

      <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-edge] sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Owned" value={formatCount(stats.plots.owned ?? 0)} />
        <Metric label="Available" value={formatCount(stats.plots.available ?? 0)} />
        <Metric label="Locked" value={formatCount(stats.plots.locked ?? 0)} />
        <Metric label="Empires" value={formatCount(stats.empires)} />
        <Metric label="Gross" value={formatMoney(stats.grossMinor, "USD")} />
        <Metric
          label="Open exceptions"
          value={formatCount(stats.openExceptions)}
          tone={stats.openExceptions > 0 ? "danger" : undefined}
        />
      </section>

      <section className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[--color-edge] bg-[--color-edge] sm:grid-cols-4">
        <Metric label="Active locks" value={formatCount(stats.activeLocks)} />
        <Metric label="Pending purchases" value={formatCount(stats.purchases.pending ?? 0)} />
        <Metric label="Paid payments" value={formatCount(stats.payments.paid ?? 0)} />
        <Metric
          label="Unprocessed webhooks"
          value={formatCount(stats.unprocessedWebhooks)}
          tone={stats.unprocessedWebhooks > 0 ? "danger" : undefined}
        />
      </section>

      <Panel title="Payment exceptions" subtitle="Paid transactions that could not become ownership.">
        {exceptions.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <Table head={["Reason", "Purchase", "Payment", "Raised", ""]}>
            {exceptions.map((row) => (
              <tr key={row.id} className="border-b border-[--color-edge] last:border-0">
                <Cell className="text-[--color-danger]">{row.reason}</Cell>
                <Cell mono>{row.purchaseId?.slice(0, 8) ?? "—"}</Cell>
                <Cell mono>{row.paymentId?.slice(0, 8) ?? "—"}</Cell>
                <Cell>{new Date(row.createdAt).toLocaleString()}</Cell>
                <Cell>
                  <ResolveException id={row.id} />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Pricing rules" subtitle="Changes apply to new purchases only.">
        <Table head={["Name", "Tier", "Price", "Limit", "Claimed", "Active", ""]}>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-b border-[--color-edge] last:border-0">
              <Cell>{rule.name}</Cell>
              <Cell>{rule.tier}</Cell>
              <Cell mono>{formatMoney(rule.priceMinor, rule.currency)}</Cell>
              <Cell mono>{rule.inventoryLimit ?? "∞"}</Cell>
              <Cell mono>{formatCount(rule.claimed)}</Cell>
              <Cell>{rule.isActive ? "yes" : "no"}</Cell>
              <Cell>
                <PricingToggle id={rule.id} isActive={rule.isActive} />
              </Cell>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Live reservations" subtitle="Plots currently held by a checkout.">
        {lockedPlots.length === 0 ? (
          <Empty>No plots are reserved right now.</Empty>
        ) : (
          <Table head={["Plot", "Expires", "Purchase", ""]}>
            {lockedPlots.map((plot) => (
              <tr key={plot.id} className="border-b border-[--color-edge] last:border-0">
                <Cell mono>
                  {plot.gridX}, {plot.gridY}
                </Cell>
                <Cell>
                  {plot.activeLock
                    ? `${new Date(plot.activeLock.expiresAt).toLocaleTimeString()}${plot.activeLock.expired ? " (lapsed)" : ""}`
                    : "—"}
                </Cell>
                <Cell mono>{plot.activeLock?.purchaseId.slice(0, 8) ?? "—"}</Cell>
                <Cell>
                  <PlotToggle plotId={plot.id} status={plot.status} />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Recent purchases">
        <Table head={["Status", "Plot", "Amount", "User", "Payments", "Created"]}>
          {purchases.map((row) => (
            <tr key={row.id} className="border-b border-[--color-edge] last:border-0">
              <Cell>{row.status}</Cell>
              <Cell mono>
                {row.plot.gridX}, {row.plot.gridY}
              </Cell>
              <Cell mono>{formatMoney(row.amountMinor, row.currency)}</Cell>
              <Cell className="max-w-[16rem] truncate">{row.user.email}</Cell>
              <Cell mono>{row.payments.length}</Cell>
              <Cell>{new Date(row.createdAt).toLocaleString()}</Cell>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Recent payments">
        <Table head={["Status", "Amount", "Provider payment", "Order", "Created"]}>
          {payments.map((row) => (
            <tr key={row.id} className="border-b border-[--color-edge] last:border-0">
              <Cell>{row.status}</Cell>
              <Cell mono>{formatMoney(row.amountMinor, row.currency)}</Cell>
              <Cell mono>{row.providerPaymentId ?? "—"}</Cell>
              <Cell mono>{row.providerOrderId ?? "—"}</Cell>
              <Cell>{new Date(row.createdAt).toLocaleString()}</Cell>
            </tr>
          ))}
        </Table>
      </Panel>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="bg-[--color-surface] px-4 py-4">
      <p className="text-[0.65rem] uppercase tracking-[0.14em] text-[--color-ink-faint]">{label}</p>
      <p
        className={`tabular mt-1 font-mono text-xl font-semibold ${tone === "danger" ? "text-[--color-danger]" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-[--color-ink-faint]">{subtitle}</p>}
      <div className="mt-3 overflow-x-auto rounded-2xl border border-[--color-edge]">{children}</div>
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="border-b border-[--color-edge] bg-[--color-surface-2] text-left text-xs uppercase tracking-[0.12em] text-[--color-ink-faint]">
          {head.map((label, index) => (
            <th key={`${label}-${index}`} className="px-4 py-2.5 font-medium">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-[--color-surface]">{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  mono,
  className = "",
}: {
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return <td className={`px-4 py-2.5 ${mono ? "font-mono tabular text-xs" : ""} ${className}`}>{children}</td>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="bg-[--color-surface] p-8 text-center text-sm text-[--color-ink-faint]">{children}</p>;
}
