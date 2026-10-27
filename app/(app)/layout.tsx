import Link from "next/link";
import { Suspense } from "react";
import Nav from "@/components/Nav";
import Logo from "@/components/Logo";
import { getCurrentUser, getProfile } from "@/lib/auth";
import { canUseStudio } from "@/lib/studio/access.server";
import { getTabAccess } from "@/lib/tabs.server";
import { signOut } from "@/app/login/actions";
import { ROLES, isRole } from "@/lib/roles";
import ThemeToggle from "@/components/ThemeToggle";
import { getTheme } from "@/lib/theme";
import ChatWidget from "@/components/chat/ChatWidgetLazy";
import UserAvatar from "@/components/UserAvatar";
import Presence from "@/components/Presence";
import NotifPrompt from "@/components/NotifPrompt";
import UpdateNotice from "@/components/UpdateNotice";
import SoundNotifier from "@/components/SoundNotifier";
import TabNotice from "@/components/TabNotice";
import TabAccessProvider from "@/components/TabAccessProvider";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ user }, profile, theme, access, pendingVr, studio] = await Promise.all([
    getCurrentUser(),
    getProfile(),
    getTheme(),
    // tab yang ditutup admin untuk user ini (tabel belum ada -> tidak ada yang ditutup)
    getTabAccess(),
    // jumlah Video Review yang masih "menunggu" (bubble angka di tab Video Review). Dihitung BARENG cek tab
    // (tidak menunggu), hasilnya dibuang kalau tab Video Review ditutup
    (async () => {
      const { supabase } = await getCurrentUser();
      const [r, a] = await Promise.all([
        supabase.from("video_reviews").select("id", { count: "exact", head: true }).eq("status", "menunggu"),
        getTabAccess(),
      ]);
      return a.blocked.has("video_review") ? 0 : (r.count ?? 0);
    })().catch(() => 0),
    // menu Studio: admin atau user yang diberi akses (gagal cek -> disembunyikan)
    canUseStudio().catch(() => false),
  ]);
  const name = profile?.full_name || user.email;
  const role = profile && isRole(profile.role) ? ROLES[profile.role] : null;
  const closed = [...access.blocked];

  return (
    // daftar tab yang ditutup ikut diperbarui di browser (pindah halaman / kembali ke tab) -> menu & chat melayang ikut berubah
    <TabAccessProvider initial={closed}>
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          {/* HP: baris 1 = logo + akun, baris 2 = menu (penuh selebar layar); layar lebar: semua sebaris */}
          <div className="contents sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-4">
            <Link href="/" className="order-1 flex items-center gap-2.5 sm:order-none">
              <Logo />
              <span className="leading-tight">
                <span className="font-display block text-[15px] font-bold">CS Tracker</span>
                <span className="block text-[11px] font-medium text-zinc-500">Konten.com</span>
              </span>
            </Link>
            <div className="order-3 w-full sm:order-none sm:w-auto">
              <Nav role={profile?.role ?? null} pendingVr={pendingVr} studio={studio} />
            </div>
          </div>
          <div className="order-2 flex items-center gap-1.5 sm:order-none sm:gap-2">
            <Link
              href="/akun"
              title={name}
              className="flex items-center gap-2 rounded-full border border-zinc-800/80 bg-zinc-900 p-1 transition hover:border-zinc-700 sm:pr-3"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              <UserAvatar name={name} url={profile?.avatar_url} size={28} />
              {/* HP: cukup foto profil supaya logo + akun muat sebaris */}
              <span className="hidden leading-tight sm:block">
                <span className="block max-w-[140px] truncate text-xs font-semibold">{name}</span>
                {role && <span className={`block text-[10px] font-semibold ${role.cls}`}>{role.label}</span>}
              </span>
            </Link>
            <ThemeToggle initial={theme} />
            <form action={signOut}>
              <button className="btn-ghost rounded-full px-2.5 py-1.5 text-xs sm:px-3">Keluar</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-8">
        <Suspense fallback={null}>
          <TabNotice />
        </Suspense>
        {children}
      </main>
      {/* chat melayang hanya kalau tab Chat terbuka (dicek di ChatWidgetLazy; tidak berlangganan pesan kalau ditutup) */}
      <ChatWidget meId={user.id} />
      <Presence />
      <NotifPrompt />
      <UpdateNotice />
      <SoundNotifier meId={user.id} />
    </div>
    </TabAccessProvider>
  );
}
