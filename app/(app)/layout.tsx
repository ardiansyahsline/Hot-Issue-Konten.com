import Link from "next/link";
import Nav from "@/components/Nav";
import Logo from "@/components/Logo";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { ROLES, isRole } from "@/lib/roles";
import ThemeToggle from "@/components/ThemeToggle";
import { getTheme } from "@/lib/theme";
import ChatWidget from "@/components/chat/ChatWidgetLazy";
import UserAvatar from "@/components/UserAvatar";
import Presence from "@/components/Presence";
import NotifPrompt from "@/components/NotifPrompt";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ user }, profile, theme] = await Promise.all([getCurrentUser(), getProfile(), getTheme()]);
  const name = profile?.full_name || user.email;
  const role = profile && isRole(profile.role) ? ROLES[profile.role] : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo />
              <span className="leading-tight">
                <span className="font-display block text-[15px] font-bold">CS Tracker</span>
                <span className="block text-[11px] font-medium text-zinc-500">Konten.com</span>
              </span>
            </Link>
            <Nav role={profile?.role ?? null} />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/akun"
              className="flex items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-900 py-1 pl-1 pr-3 transition hover:border-zinc-700"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              <UserAvatar name={name} url={profile?.avatar_url} size={28} />
              <span className="leading-tight">
                <span className="block max-w-[140px] truncate text-xs font-semibold">{name}</span>
                {role && <span className={`block text-[10px] font-semibold ${role.cls}`}>{role.label}</span>}
              </span>
            </Link>
            <ThemeToggle initial={theme} />
            <form action={signOut}>
              <button className="btn-ghost rounded-full px-3 py-1.5 text-xs">Keluar</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">{children}</main>
      <ChatWidget meId={user.id} />
      <Presence />
      <NotifPrompt />
    </div>
  );
}
