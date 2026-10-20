import Link from "next/link";
import Nav from "@/components/Nav";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { ROLES, isRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ user }, profile] = await Promise.all([getCurrentUser(), getProfile()]);
  const name = profile?.full_name || user.email;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span>🔥</span> Hot Issues CS
            </Link>
            <Nav role={profile?.role ?? null} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/akun" className="text-zinc-400 hover:text-zinc-200">
              {name}
              {profile && isRole(profile.role) && (
                <span className={`ml-1 text-xs ${ROLES[profile.role].cls}`}>({ROLES[profile.role].label})</span>
              )}
            </Link>
            <form action={signOut}>
              <button className="btn-ghost px-2.5 py-1 text-xs">Keluar</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
