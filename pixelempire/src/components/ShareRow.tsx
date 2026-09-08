"use client";

import { useState } from "react";

interface Props {
  slug: string;
  gridX?: number;
  gridY?: number;
  className?: string;
}

/** Post-claim share experience (§30). */
export default function ShareRow({ slug, gridX, gridY, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  const url = typeof window === "undefined" ? `/e/${slug}` : `${window.location.origin}/e/${slug}`;
  const where = gridX !== undefined && gridY !== undefined ? ` at ${gridX},${gridY}` : "";
  const text = `I just claimed my piece of the internet${where} on PixelEmpire.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a
        href={`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-[--color-edge] px-4 py-2 text-sm font-medium transition hover:border-[--color-edge-bright] hover:text-[--color-gold]"
      >
        Share on X
      </a>
      <button
        onClick={copy}
        className="rounded-lg border border-[--color-edge] px-4 py-2 text-sm font-medium transition hover:border-[--color-edge-bright]"
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}
