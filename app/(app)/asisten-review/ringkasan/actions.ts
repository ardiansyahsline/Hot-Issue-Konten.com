"use server";

import { revalidatePath } from "next/cache";
import { arErrorText } from "@/lib/asistenReview";
import { asistenGuard } from "@/lib/asistenReview.server";
import { UUID_RE, arAdmin, arBucket } from "@/lib/asistenReviewStorage.server";

/**
 * Admin: hapus run uji lama (RLS review_runs_admin_delete: admin & status ≠ proses). Hasil per video ikut terhapus
 * (on delete cascade). Laporan laporan/<id>.html ditulis laptop → hanya service role yang boleh menghapus; kunci tidak
 * ada di server → file dibiarkan (privat, tidak terlihat lagi karena run-nya hilang).
 */
export async function hapusRun(runId: string): Promise<{ ok?: true; error?: string }> {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error };
  if (!g.ctx.admin) return { error: "Hanya admin yang bisa menghapus run." };
  if (typeof runId !== "string" || !UUID_RE.test(runId)) return { error: "Run tidak valid. Muat ulang halaman." };
  const sb = g.ctx.supabase;

  const { data: run, error: e1 } = await sb.from("review_runs").select("id, status, report_path").eq("id", runId).maybeSingle();
  if (e1) return { error: arErrorText(e1) };
  if (!run) return { error: "Run tidak ditemukan (mungkin sudah dihapus)." };
  if (run.status === "proses") return { error: "Run masih berjalan. Batalkan dulu di menu Jalankan uji." };

  const { data: del, error: e2 } = await sb.from("review_runs").delete().eq("id", runId).select("id");
  if (e2) return { error: arErrorText(e2, "Gagal menghapus run. Coba lagi.") };
  if (!del?.length) return { error: "Run tidak bisa dihapus (sedang berjalan atau bukan admin)." };

  const lap = typeof run.report_path === "string" && /^laporan\/[0-9a-f-]{36}\.html$/i.test(run.report_path) ? run.report_path : null;
  const admin = lap ? arAdmin() : null;
  if (admin && lap) {
    try {
      await arBucket(admin).remove([lap]);
    } catch {
      /* file tertinggal di bucket privat — tidak apa-apa */
    }
  }
  revalidatePath("/asisten-review/ringkasan");
  revalidatePath("/asisten-review");
  return { ok: true };
}
