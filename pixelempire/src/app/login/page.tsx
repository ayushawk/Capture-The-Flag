import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const user = await getSessionUser();
  const destination = next && next.startsWith("/") ? next : "/map";
  if (user) redirect(destination);

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-md flex-col justify-center px-4 py-16">
      <h1 className="font-display text-3xl">Claim your territory</h1>
      <p className="mt-2 text-sm text-[--color-ink-soft]">
        Enter your email and we will send you a sign-in link. No password to remember.
      </p>
      {error && (
        <p className="mt-4 rounded-lg border border-[--color-danger] bg-[rgba(255,92,122,0.08)] px-3 py-2 text-sm text-[--color-danger]">
          {error === "invalid_link"
            ? "That sign-in link has expired or was already used. Request a new one below."
            : "We could not sign you in. Please request a new link."}
        </p>
      )}
      <LoginForm next={destination} />
    </main>
  );
}
