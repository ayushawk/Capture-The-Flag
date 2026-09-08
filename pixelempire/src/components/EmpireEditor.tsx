"use client";

import { useState } from "react";
import Link from "next/link";

interface Empire {
  name: string;
  slug: string;
  description: string | null;
  xUsername: string | null;
  websiteUrl: string | null;
  avatarUrl: string | null;
}

type State = "idle" | "saving" | "saved" | "error";

export default function EmpireEditor({ empire }: { empire: Empire }) {
  const [form, setForm] = useState({
    name: empire.name,
    slug: empire.slug,
    description: empire.description ?? "",
    xUsername: empire.xUsername ?? "",
    websiteUrl: empire.websiteUrl ?? "",
    avatarUrl: empire.avatarUrl ?? "",
  });
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [slug, setSlug] = useState(empire.slug);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("saving");
    setMessage(null);

    try {
      const response = await fetch("/api/me/empire", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        setState("error");
        setMessage(
          data?.error?.details?.[0]?.message ??
            data?.error?.message ??
            "We could not save those changes.",
        );
        return;
      }

      setState("saved");
      setSlug(data.empire.slug);
      setForm((current) => ({ ...current, slug: data.empire.slug }));
      setMessage("Saved.");
    } catch {
      setState("error");
      setMessage("We could not reach the server. Check your connection and try again.");
    }
  };

  return (
    <form onSubmit={save} className="mt-8 space-y-5">
      <Field label="Empire name" hint="Shown on the map, the leaderboard and your public page.">
        <input {...field("name")} maxLength={40} required className={inputClass} />
      </Field>

      <Field label="Address" hint={`pixelempire.com/e/${slug}`}>
        <input {...field("slug")} maxLength={40} required className={inputClass} />
      </Field>

      <Field label="Description" hint="Up to 280 characters.">
        <textarea {...field("description")} maxLength={280} rows={3} className={inputClass} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="X handle">
          <input {...field("xUsername")} placeholder="@yourname" className={inputClass} />
        </Field>
        <Field label="Website">
          <input {...field("websiteUrl")} placeholder="https://example.com" className={inputClass} />
        </Field>
      </div>

      <Field label="Avatar URL" hint="A direct https link to an image.">
        <input {...field("avatarUrl")} placeholder="https://…" className={inputClass} />
      </Field>

      {message && (
        <p
          className={`text-sm ${state === "error" ? "text-[--color-danger]" : "text-[--color-good]"}`}
          role="status"
        >
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={state === "saving"}
          className="rounded-xl bg-[--color-gold] px-6 py-3 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft] disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save empire"}
        </button>
        <Link
          href={`/e/${slug}`}
          className="rounded-xl border border-[--color-edge] px-6 py-3 font-medium transition hover:border-[--color-edge-bright]"
        >
          View public page
        </Link>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-xl border border-[--color-edge] bg-[--color-surface] px-4 py-3 text-[--color-ink] placeholder:text-[--color-ink-faint] focus:border-[--color-gold] focus:outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-[--color-ink-faint]">{hint}</span>}
    </label>
  );
}
