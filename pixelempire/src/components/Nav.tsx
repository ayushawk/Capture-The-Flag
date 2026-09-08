import Link from "next/link";
import { getSessionUser } from "@/server/auth/session";
import { prisma } from "@/lib/db";
import SignOutButton from "./SignOutButton";

/** Server-rendered nav: the session is read once, not fetched by the client. */
export default async function Nav() {
  const user = await getSessionUser();
  const empire = user ? await prisma.empire.findUnique({ where: { ownerUserId: user.id } }) : null;

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-[--color-edge] bg-[rgba(7,8,15,0.82)] backdrop-blur">
      <nav className="mx-auto flex h-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg tracking-tight">
          <span className="inline-block h-3.5 w-3.5 rounded-[3px] bg-[--color-gold]" />
          PixelEmpire
        </Link>

        <div className="flex items-center gap-1 text-sm sm:gap-3">
          <Link href="/map" className="rounded-lg px-3 py-1.5 text-[--color-ink-soft] hover:text-[--color-ink]">
            Map
          </Link>
          <Link
            href="/leaderboard"
            className="hidden rounded-lg px-3 py-1.5 text-[--color-ink-soft] hover:text-[--color-ink] sm:block"
          >
            Leaderboard
          </Link>
          {user?.isAdmin && (
            <Link href="/admin" className="rounded-lg px-3 py-1.5 text-[--color-ink-soft] hover:text-[--color-ink]">
              Admin
            </Link>
          )}
          {user ? (
            <div className="flex items-center gap-2">
              {empire && (
                <Link
                  href={`/e/${empire.slug}`}
                  className="max-w-[9rem] truncate rounded-lg px-3 py-1.5 text-[--color-ink-soft] hover:text-[--color-ink]"
                >
                  {empire.name}
                </Link>
              )}
              <SignOutButton />
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[--color-gold] px-4 py-1.5 font-semibold text-[--color-void] transition hover:bg-[--color-gold-soft]"
            >
              Claim land
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
