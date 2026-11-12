import { arErrorText } from "@/lib/asistenReview";
import { requireAsisten } from "@/lib/asistenReview.server";
import { UUID_RE } from "@/lib/asistenReviewStorage.server";
import BelumSiap from "@/components/asisten/BelumSiap";
import RingkasanView, { type ContohKasus, type PemakaianHarian } from "@/components/asisten/ringkasan/RingkasanView";
import { adaMetrik, bandingPasangan, type BarisPasang, type Pasangan, type RunRingkas } from "@/components/asisten/ringkasan/hitung";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// kolom `sample` (daftar id video, bisa 500 baris) sengaja tidak diambil
const RUN_COLS =
  "id, job_id, label, rubric_version, rubric_hash, model, effort, sample_size, sample_params, status, done, metrics, cost_usd, report_path, worker, created_by, started_at, finished_at, created_at";
const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /schema cache|does not exist/i.test(e.message ?? ""));

export default async function RingkasanPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireAsisten();
  if (!ctx.ready) return <BelumSiap />;
  const sp = await searchParams;
  const sb = ctx.supabase;

  const [runsRes, usageRes] = await Promise.all([
    sb.from("review_runs").select(RUN_COLS).order("created_at", { ascending: false }).limit(60),
    sb.from("review_usage_daily").select("day, cost_usd, calls").order("day", { ascending: false }).limit(14),
  ]);
  if (missing(runsRes.error)) return <BelumSiap />;
  const runs = ((runsRes.data ?? []) as unknown as RunRingkas[]).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) || 0 }));
  let peringatan = runsRes.error ? arErrorText(runsRes.error, "Daftar run gagal dibaca. Muat ulang halaman.") : null;

  const mau = satu(sp.run);
  const run = (UUID_RE.test(mau) && runs.find((r) => r.id === mau)) || runs.find((r) => adaMetrik(r.metrics)) || runs[0] || null;
  const mauB = satu(sp.banding);
  const pembanding = (run && UUID_RE.test(mauB) && mauB !== run.id && runs.find((r) => r.id === mauB)) || null;

  // contoh kasus benar / salah (id hasil dari metrics.contoh) + banding berpasangan (video yang sama di dua run)
  const ids = run && adaMetrik(run.metrics) ? [...(run.metrics.contoh?.benar ?? []), ...(run.metrics.contoh?.salah ?? [])].filter(Number.isSafeInteger).slice(0, 20) : [];
  const [contohRes, pasangan] = await Promise.all([
    ids.length
      ? sb
          .from("review_results")
          .select("id, video_id, campaign_title, suggestion, final_truth, official_reason, specific_reason, confidence")
          .in("id", ids)
      : Promise.resolve({ data: [] as ContohKasus[], error: null }),
    run && pembanding ? hitungPasangan(sb, pembanding.id, run.id) : Promise.resolve(null),
  ]);
  if (contohRes.error && !peringatan) peringatan = arErrorText(contohRes.error, "Contoh kasus gagal dibaca.");
  const urut = new Map(ids.map((id, i) => [id, i]));
  const contoh = ((contohRes.data ?? []) as ContohKasus[]).sort((a, b) => (urut.get(a.id) ?? 0) - (urut.get(b.id) ?? 0));
  const pemakaian = ((usageRes.data ?? []) as PemakaianHarian[]).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) || 0 })).reverse();

  return (
    <RingkasanView
      runs={runs}
      run={run}
      pembanding={pembanding}
      pasangan={pasangan}
      contoh={contoh}
      pemakaian={pemakaian}
      admin={ctx.admin}
      peringatan={peringatan}
    />
  );
}

type Sb = Awaited<ReturnType<typeof requireAsisten>>["supabase"];

/** semua hasil dua run (maks 3000 per run, per 1000 baris) → banding berpasangan; gagal → null (bagian itu tidak tampil) */
async function hitungPasangan(sb: Sb, lamaId: string, baruId: string): Promise<Pasangan | null> {
  const ambil = async (runId: string) => {
    const out: BarisPasang[] = [];
    for (let hal = 0; hal < 3; hal++) {
      const { data, error } = await sb
        .from("review_results")
        .select("video_id, pipeline_status, suggestion, human_decision, human_code, appeal, final_truth")
        .eq("run_id", runId)
        .order("id")
        .range(hal * 1000, hal * 1000 + 999);
      if (error) throw error;
      out.push(...((data ?? []) as BarisPasang[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  try {
    const [a, b] = await Promise.all([ambil(lamaId), ambil(baruId)]);
    return bandingPasangan(a, b);
  } catch {
    return null;
  }
}
