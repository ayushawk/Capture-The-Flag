"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PlotDetail } from "@/server/services/read";
import type { RazorpayHandlerResponse } from "@/types/razorpay";
import { formatMoney } from "@/lib/palette";

/**
 * Every state the claim can be in (§42).
 *
 * `confirming` is the important one: money has been taken but ownership has not
 * been written yet. It must never be shown as a failure.
 */
type Phase =
  | "idle"
  | "reserving"
  | "reserved"
  | "checkout"
  | "verifying"
  | "confirming"
  | "owned"
  | "expired"
  | "taken"
  | "refunding"
  | "error";

interface Reservation {
  purchaseId: string;
  amountMinor: number;
  currency: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  expiresAt: string;
}

interface Props {
  plot: PlotDetail | null;
  loading: boolean;
  signedIn: boolean;
  userEmail?: string | null;
  ownedByYou: boolean;
  onClaimed: (empireSlug: string) => void;
  onClose: () => void;
}

const CONFIRM_POLL_MS = 2500;
const CONFIRM_TIMEOUT_MS = 90_000;

const remainingLabel = (msLeft: number): string => {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function ClaimPanel({
  plot,
  loading,
  signedIn,
  userEmail,
  ownedByYou,
  onClaimed,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [msLeft, setMsLeft] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A new plot selection resets the panel unless a payment is in flight.
  useEffect(() => {
    if (phase === "verifying" || phase === "confirming") return;
    setPhase("idle");
    setReservation(null);
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot?.id]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Reservation countdown.
  useEffect(() => {
    if (!reservation || (phase !== "reserved" && phase !== "checkout")) return;
    const expiry = new Date(reservation.expiresAt).getTime();

    const tick = () => {
      const left = expiry - Date.now();
      setMsLeft(left);
      if (left <= 0) {
        setPhase("expired");
        setMessage("Your reservation ran out. The plot is back on the map.");
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [reservation, phase]);

  const pollUntilOwned = useCallback(
    (purchaseId: string) => {
      const startedAt = Date.now();
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/purchases/${purchaseId}`);
          if (response.ok) {
            const data = (await response.json()) as {
              status: string;
              ownedByYou: boolean;
              plot: { gridX: number; gridY: number };
            };
            if (data.ownedByYou || data.status === "completed") {
              if (pollRef.current) clearInterval(pollRef.current);
              setPhase("owned");
              const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null));
              onClaimed(me?.empire?.slug ?? "");
              return;
            }
          }
        } catch {
          // Keep polling: a dropped request is not a failed payment.
        }

        if (Date.now() - startedAt > CONFIRM_TIMEOUT_MS) {
          if (pollRef.current) clearInterval(pollRef.current);
          setMessage(
            "Your payment was received and we are still confirming ownership. This can take a few minutes — your territory will appear on your empire page.",
          );
        }
      }, CONFIRM_POLL_MS);
    },
    [onClaimed],
  );

  const verify = useCallback(
    async (purchaseId: string, response: RazorpayHandlerResponse) => {
      setPhase("verifying");
      setMessage(null);
      try {
        const result = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purchaseId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          }),
        });
        const data = (await result.json()) as {
          status?: string;
          empireSlug?: string;
          message?: string;
          error?: { message?: string };
        };

        if (result.ok && data.status === "completed") {
          setPhase("owned");
          onClaimed(data.empireSlug ?? "");
          return;
        }

        if (result.status === 409 && data.status === "refund_pending") {
          setPhase("refunding");
          setMessage(data.message ?? "Your payment went through, but this plot was claimed first.");
          return;
        }

        // Anything else means the payment is real but not yet confirmed —
        // never say "failed" here.
        setPhase("confirming");
        setMessage(data.message ?? "Your payment was received. We're confirming your territory ownership.");
        pollUntilOwned(purchaseId);
      } catch {
        setPhase("confirming");
        setMessage("Your payment was received. We're confirming your territory ownership.");
        pollUntilOwned(purchaseId);
      }
    },
    [onClaimed, pollUntilOwned],
  );

  const openCheckout = useCallback(
    (current: Reservation) => {
      if (!window.Razorpay) {
        setPhase("error");
        setMessage("Checkout could not load. Check your connection and try again.");
        return;
      }
      setPhase("checkout");

      const checkout = new window.Razorpay({
        key: current.razorpayKeyId,
        amount: current.amountMinor,
        currency: current.currency,
        order_id: current.razorpayOrderId,
        name: "PixelEmpire",
        description: plot ? `Territory ${plot.gridX}, ${plot.gridY}` : "Territory",
        prefill: userEmail ? { email: userEmail } : undefined,
        theme: { color: "#f5b53d", backdrop_color: "#07080f" },
        modal: {
          ondismiss: () => {
            // Closing the modal does not cancel the reservation — the plot is
            // still held and the same order can be paid again (§10).
            setPhase("reserved");
            setMessage("Checkout closed. Your plot is still reserved — you can pay again.");
          },
        },
        handler: (response) => void verify(current.purchaseId, response),
      });

      checkout.on("payment.failed", () => {
        setPhase("reserved");
        setMessage("That payment did not go through. Your plot is still reserved — try again.");
      });

      checkout.open();
    },
    [plot, userEmail, verify],
  );

  const reserve = useCallback(async () => {
    if (!plot) return;
    setPhase("reserving");
    setMessage(null);

    try {
      const response = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the plot id. Price and everything else is the server's business.
        body: JSON.stringify({ plotId: plot.id }),
      });
      const data = await response.json();

      if (!response.ok) {
        const code = data?.error?.code as string | undefined;
        if (code === "plot_owned" || code === "plot_unavailable") {
          setPhase("taken");
          setMessage(data.error.message);
        } else if (code === "unauthenticated") {
          window.location.href = `/login?next=${encodeURIComponent(`/map?x=${plot.gridX}&y=${plot.gridY}`)}`;
        } else {
          setPhase("error");
          setMessage(data?.error?.message ?? "We could not reserve that plot. Please try again.");
        }
        return;
      }

      const current = data as Reservation;
      setReservation(current);
      setPhase("reserved");
      openCheckout(current);
    } catch {
      setPhase("error");
      setMessage("We could not reach the server. Check your connection and try again.");
    }
  }, [openCheckout, plot]);

  if (!plot && !loading) return null;

  return (
    <section
      aria-live="polite"
      className="panel flex max-h-[70vh] flex-col overflow-y-auto rounded-t-2xl p-5 md:max-h-none md:rounded-2xl"
    >
      {loading || !plot ? (
        <div className="space-y-3">
          <div className="skeleton h-5 w-32 rounded" />
          <div className="skeleton h-10 w-full rounded" />
          <div className="skeleton h-10 w-2/3 rounded" />
        </div>
      ) : (
        <>
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[--color-ink-faint]">Territory</p>
              <h2 className="font-mono text-2xl font-semibold tabular">
                {plot.gridX}, {plot.gridY}
              </h2>
              <p className="mt-1 text-xs text-[--color-ink-faint]">
                {plot.pixelWidth} × {plot.pixelHeight} pixels · logical {plot.logicalX}, {plot.logicalY}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close plot details"
              className="rounded-lg border border-[--color-edge] px-2 py-1 text-sm text-[--color-ink-soft] hover:text-[--color-ink]"
            >
              ✕
            </button>
          </header>

          <StatusBadge plot={plot} ownedByYou={ownedByYou} />

          {plot.empire && (
            <div className="mt-4 rounded-xl border border-[--color-edge] bg-[--color-surface-2] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[--color-ink-faint]">Held by</p>
              <Link
                href={`/e/${plot.empire.slug}`}
                className="mt-1 block text-lg font-semibold hover:text-[--color-gold]"
              >
                {plot.empire.name}
              </Link>
              {plot.empire.description && (
                <p className="mt-2 text-sm text-[--color-ink-soft]">{plot.empire.description}</p>
              )}
              {plot.empire.xUsername && (
                <a
                  href={`https://x.com/${plot.empire.xUsername}`}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-2 inline-block text-sm text-[--color-claimed-soft] hover:underline"
                >
                  @{plot.empire.xUsername}
                </a>
              )}
            </div>
          )}

          {message && (
            <p
              className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                phase === "refunding" || phase === "confirming"
                  ? "border-[--color-gold-deep] bg-[rgba(245,181,61,0.08)] text-[--color-gold-soft]"
                  : phase === "error" || phase === "taken"
                    ? "border-[--color-danger] bg-[rgba(255,92,122,0.08)] text-[--color-danger]"
                    : "border-[--color-edge] bg-[--color-surface-2] text-[--color-ink-soft]"
              }`}
            >
              {message}
            </p>
          )}

          <div className="mt-5">
            {plot.status === "available" && phase !== "owned" && (
              <ClaimAction
                phase={phase}
                signedIn={signedIn}
                plot={plot}
                reservation={reservation}
                msLeft={msLeft}
                onReserve={reserve}
                onPayAgain={() => reservation && openCheckout(reservation)}
              />
            )}

            {phase === "owned" && (
              <p className="rounded-lg border border-[--color-good] bg-[rgba(61,220,151,0.08)] px-3 py-3 text-sm text-[--color-good]">
                This territory is yours. Name your empire and share it.
              </p>
            )}

            {plot.status === "locked" && phase === "idle" && (
              <p className="text-sm text-[--color-ink-soft]">
                Someone is claiming this plot right now. If they do not finish, it returns to the map
                within ten minutes.
              </p>
            )}

            {plot.status === "unreleased" && (
              <p className="text-sm text-[--color-ink-soft]">
                This land has not been released. Only the founding territory is on sale today.
              </p>
            )}

            {plot.status === "disabled" && (
              <p className="text-sm text-[--color-ink-soft]">This plot is not available.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ plot, ownedByYou }: { plot: PlotDetail; ownedByYou: boolean }) {
  const tone: Record<string, string> = {
    available: "border-[--color-gold-deep] bg-[rgba(245,181,61,0.12)] text-[--color-gold]",
    owned: "border-[--color-edge-bright] bg-[--color-surface-2] text-[--color-claimed-soft]",
    locked: "border-[--color-locked] bg-[rgba(255,138,92,0.1)] text-[--color-locked]",
    unreleased: "border-[--color-edge] bg-[--color-surface-2] text-[--color-ink-faint]",
    disabled: "border-[--color-edge] bg-[--color-surface-2] text-[--color-ink-faint]",
  };
  const label: Record<string, string> = {
    available: "Founding land · available",
    owned: ownedByYou ? "Yours" : "Claimed",
    locked: "Being claimed",
    unreleased: "Not released",
    disabled: "Unavailable",
  };
  return (
    <span
      className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${tone[plot.status] ?? tone.unreleased}`}
    >
      {label[plot.status] ?? plot.status}
    </span>
  );
}

function ClaimAction({
  phase,
  signedIn,
  plot,
  reservation,
  msLeft,
  onReserve,
  onPayAgain,
}: {
  phase: Phase;
  signedIn: boolean;
  plot: PlotDetail;
  reservation: Reservation | null;
  msLeft: number;
  onReserve: () => void;
  onPayAgain: () => void;
}) {
  const price = reservation ? formatMoney(reservation.amountMinor, reservation.currency) : "$1";

  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/map?x=${plot.gridX}&y=${plot.gridY}`)}`}
        className="block w-full rounded-xl bg-[--color-gold] px-4 py-3 text-center font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft]"
      >
        Sign in to claim this plot
      </Link>
    );
  }

  if (phase === "reserved" || phase === "checkout") {
    const low = msLeft < 60_000;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-[--color-edge] bg-[--color-surface-2] px-4 py-3">
          <span className="text-sm text-[--color-ink-soft]">Reserved for you</span>
          <span className={`tabular font-mono text-lg ${low ? "text-[--color-danger]" : "text-[--color-gold]"}`}>
            {remainingLabel(msLeft)}
          </span>
        </div>
        <button
          onClick={onPayAgain}
          disabled={phase === "checkout"}
          className="w-full rounded-xl bg-[--color-gold] px-4 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft] disabled:opacity-60"
        >
          {phase === "checkout" ? "Checkout open…" : `Pay ${price}`}
        </button>
      </div>
    );
  }

  if (phase === "verifying" || phase === "confirming") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[--color-edge] bg-[--color-surface-2] px-4 py-3 text-sm text-[--color-ink-soft]">
        <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-[--color-gold]" />
        Confirming your territory…
      </div>
    );
  }

  if (phase === "refunding") return null;

  return (
    <button
      onClick={onReserve}
      disabled={phase === "reserving"}
      className="w-full rounded-xl bg-[--color-gold] px-4 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft] disabled:opacity-60"
    >
      {phase === "reserving" ? "Reserving…" : phase === "expired" || phase === "taken" ? "Try again" : "Claim for $1"}
    </button>
  );
}
