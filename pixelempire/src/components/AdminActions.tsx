"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Small imperative controls for the admin console. Every one of these hits a
 *  server-authorised endpoint — hiding the UI is not the control (§24). */
export function PlotToggle({ plotId, status }: { plotId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = status === "disabled";
  const canAct = disabled || status === "available" || status === "unreleased";

  const act = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/plots/${plotId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: disabled ? "enable" : "disable" }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error?.message ?? "Failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!canAct) return <span className="text-xs text-[--color-ink-faint]">—</span>;

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={act}
        disabled={busy}
        className="rounded border border-[--color-edge] px-2 py-1 text-xs hover:border-[--color-edge-bright] disabled:opacity-50"
      >
        {busy ? "…" : disabled ? "Enable" : "Disable"}
      </button>
      {error && <span className="text-xs text-[--color-danger]">{error}</span>}
    </span>
  );
}

export function ResolveException({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/admin/exceptions/${id}`, { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
      disabled={busy}
      className="rounded border border-[--color-edge] px-2 py-1 text-xs hover:border-[--color-edge-bright] disabled:opacity-50"
    >
      {busy ? "…" : "Mark handled"}
    </button>
  );
}

export function PricingToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/admin/pricing-rules/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !isActive }),
        });
        setBusy(false);
        router.refresh();
      }}
      disabled={busy}
      className="rounded border border-[--color-edge] px-2 py-1 text-xs hover:border-[--color-edge-bright] disabled:opacity-50"
    >
      {busy ? "…" : isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
