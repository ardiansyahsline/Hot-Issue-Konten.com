import { requireAsisten } from "@/lib/asistenReview.server";
import SubNav from "@/components/asisten/SubNav";
import BelumSiap from "@/components/asisten/BelumSiap";

export const dynamic = "force-dynamic";

/**
 * Tab "Asisten Review (Uji)": admin & user yang dibuka admin (Admin → Akses tab per user, tab khusus).
 * Cek akses di sini (muat pertama) DAN di tiap halaman / action / route (layout tidak dirender ulang saat pindah sub-halaman).
 * migration-23 belum dijalankan -> kartu ramah, sub-halaman tidak dirender.
 */
export default async function AsistenReviewLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAsisten();
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="page-title">🤖 Asisten Review (Uji)</h1>
          <p className="page-sub">
            <span className="badge mr-1.5 bg-violet-500/10 align-middle text-violet-300 ring-violet-500/30">MODE UJI</span>
            AI hanya menyarankan — keputusan tetap di reviewer.
          </p>
        </div>
        <SubNav />
      </div>
      {ctx.ready ? children : <BelumSiap />}
    </div>
  );
}
