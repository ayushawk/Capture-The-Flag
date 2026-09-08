"use client";

import { useState } from "react";

type State = "idle" | "sending" | "sent" | "error";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    setMessage(null);

    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const data = await response.json();

      if (!response.ok) {
        setState("error");
        setMessage(data?.error?.message ?? "We could not send that link. Please try again.");
        return;
      }
      setState("sent");
      setDevLink(data.devLink ?? null);
    } catch {
      setState("error");
      setMessage("We could not reach the server. Check your connection and try again.");
    }
  };

  if (state === "sent") {
    return (
      <div className="mt-8 rounded-2xl border border-[--color-edge] bg-[--color-surface] p-6">
        <h2 className="font-semibold">Check your email</h2>
        <p className="mt-2 text-sm text-[--color-ink-soft]">
          We sent a sign-in link to <strong className="text-[--color-ink]">{email}</strong>. It works once
          and expires in 15 minutes.
        </p>
        {devLink && (
          <p className="mt-4 break-all rounded-lg border border-[--color-gold-deep] bg-[rgba(245,181,61,0.08)] p-3 text-xs">
            <span className="font-semibold text-[--color-gold]">Development mode:</span>{" "}
            <a href={devLink} className="text-[--color-gold-soft] underline">
              {devLink}
            </a>
          </p>
        )}
        <button
          onClick={() => setState("idle")}
          className="mt-4 text-sm text-[--color-ink-faint] hover:text-[--color-ink]"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        Email address
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-xl border border-[--color-edge] bg-[--color-surface] px-4 py-3 text-[--color-ink] placeholder:text-[--color-ink-faint] focus:border-[--color-gold] focus:outline-none"
      />
      {message && <p className="text-sm text-[--color-danger]">{message}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-xl bg-[--color-gold] px-4 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft] disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
