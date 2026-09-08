"use client";

export default function SignOutButton() {
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };
  return (
    <button
      onClick={signOut}
      className="rounded-lg border border-[--color-edge] px-3 py-1.5 text-xs text-[--color-ink-soft] hover:text-[--color-ink]"
    >
      Sign out
    </button>
  );
}
