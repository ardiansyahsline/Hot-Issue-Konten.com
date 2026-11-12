import { notFound } from "next/navigation";
import { arErrorText, type ReviewResult } from "@/lib/asistenReview";
import { requireAsisten } from "@/lib/asistenReview.server";
import BelumSiap from "@/components/asisten/BelumSiap";
import HasilDetail from "@/components/asisten/hasil/HasilDetail";

export const dynamic = "force-dynamic";

const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|schema cache/i.test(e.message ?? ""));

/** Detail satu hasil AI (data diambil di sini, tampilan di components/asisten/hasil/HasilDetail.tsx). */
export default async function HasilDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAsisten();
  if (!ctx.ready) return <BelumSiap />;
  const { id: raw } = await params;
  if (!/^\d{1,15}$/.test(raw)) notFound();
  const id = Number(raw);
  const sb = ctx.supabase;

  const [res, fbRes] = await Promise.all([
    sb.from("review_results").select("*").eq("id", id).maybeSingle(),
    sb.from("review_feedback").select("user_id, agree, note, updated_at").eq("result_id", id).order("updated_at", { ascending: false }).limit(50),
  ]);
  if (missing(res.error)) return <BelumSiap />;
  if (res.error) return <BelumSiap judul="Hasil gagal dibaca" pesan={arErrorText(res.error, "Coba muat ulang halaman sebentar lagi.")} />;
  const r = res.data as ReviewResult | null;
  if (!r) notFound();

  // umpan balik tim (nama anggota CS Tracker, bukan data clipper)
  const fb = (fbRes.data ?? []) as { user_id: string; agree: boolean; note: string | null; updated_at: string }[];
  const uids = [...new Set(fb.map((x) => x.user_id))];
  const names = new Map<string, string>();
  if (uids.length) {
    const p = await sb.from("profiles").select("id, full_name, email").in("id", uids);
    for (const x of (p.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) names.set(x.id, x.full_name?.trim() || x.email || "Anggota tim");
  }
  const mineRow = fb.find((x) => x.user_id === ctx.user.id) ?? null;
  const counts = { setuju: fb.filter((x) => x.agree).length, tidak: fb.filter((x) => !x.agree).length };
  const lain = fb
    .filter((x) => x.user_id !== ctx.user.id && x.note)
    .map((x) => ({ user_id: x.user_id, nama: names.get(x.user_id) ?? "Anggota tim", agree: x.agree, note: x.note as string }));

  return <HasilDetail r={r} mine={mineRow ? { agree: mineRow.agree, note: mineRow.note } : null} counts={counts} lain={lain} />;
}

