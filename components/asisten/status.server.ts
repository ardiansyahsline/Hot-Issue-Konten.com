import "server-only";
import type { ArCtx } from "@/lib/asistenReview.server";
import type { ArStatus, JobLite, RunLite } from "./statusTypes";
import type { JobKind, JobStatus, ReviewWorker, RunStatus, Saran } from "@/lib/asistenReview";

/**
 * Status laptop + antrian + run terakhir untuk halaman "Jalankan uji" & strip status di halaman Hasil.
 * Dipakai server component (data awal) DAN /api/asisten-review/status (cadangan polling + sesudah event realtime).
 * Semua lewat sesi user (RLS migration-23). Error apa pun → data kosong + `error` awam, tidak melempar.
 */

const JOB_COLS = "id, kind, params, status, progress, message, done, total, run_id, created_by, started_at, finished_at, created_at, updated_at";
const RUN_COLS = "id, job_id, label, rubric_version, model, effort, sample_size, status, done, cost_usd, created_at, finished_at";

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
const txt = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);

/** params job → teks awam singkat (tanpa data pribadi: params memang tidak memuat link / username) */
function jobLabel(kind: string, p: Record<string, unknown>): string {
  if (kind === "uji") {
    if (p.jumlah) return `Uji ${num(p.jumlah)} video`;
    if (typeof p.lanjut_run === "string") return `Lanjutkan uji #${p.lanjut_run.slice(0, 8)}`;
    if (typeof p.ulang_run === "string") return `Ulangi uji #${p.ulang_run.slice(0, 8)} (rubrik terbaru)`;
    return "Uji akurasi";
  }
  if (kind === "video") {
    const r = (p.ref ?? {}) as Record<string, unknown>;
    const v = txt(r.nilai, 40) ?? "?";
    if (r.jenis === "platform") return `Cek video ${String(r.platform ?? "")} ${v}`.replace(/\s+/g, " ");
    return `Cek video #${v}`;
  }
  if (kind === "materi") return `Materi campaign ${txt(p.campaign_id, 64) ?? ""}`.trim();
  if (kind === "sinkron") return "Sinkron alasan reject";
  return kind;
}

export async function loadArStatus(ctx: ArCtx): Promise<ArStatus> {
  const sb = ctx.supabase;
  const now = new Date().toISOString();
  const empty: ArStatus = { now, workers: [], jobs: [], antri: 0, runs: [], hasil: {}, error: null };
  try {
    const [w, j, a, q, r] = await Promise.all([
      sb.from("review_workers").select("id, last_seen, info").order("last_seen", { ascending: false }).limit(3),
      sb.from("review_jobs").select(JOB_COLS).order("created_at", { ascending: false }).limit(15),
      // pekerjaan aktif diambil terpisah: uji 500 yang berjalan tidak boleh hilang dari daftar walau tertimbun banyak "cek video" baru
      sb.from("review_jobs").select(JOB_COLS).in("status", ["antri", "proses"]).order("created_at", { ascending: false }).limit(50),
      sb.from("review_jobs").select("id", { count: "exact", head: true }).eq("status", "antri"),
      sb.from("review_runs").select(RUN_COLS).order("created_at", { ascending: false }).limit(8),
    ]);
    const err = w.error ?? j.error ?? a.error ?? r.error;
    if (err) return { ...empty, error: err.code ?? "gagal" };

    const workers: ReviewWorker[] = ((w.data ?? []) as { id: string; last_seen: string; info: unknown }[]).map((x) => ({
      id: String(x.id).slice(0, 80),
      last_seen: x.last_seen,
      info: x.info && typeof x.info === "object" ? (x.info as ReviewWorker["info"]) : {},
    }));
    // gabung aktif + 15 terbaru (unik per id), urut terbaru dulu
    const gabung = new Map<string, Record<string, unknown>>();
    for (const x of [...((a.data ?? []) as Record<string, unknown>[]), ...((j.data ?? []) as Record<string, unknown>[])]) gabung.set(String(x.id), x);
    const jobRows = [...gabung.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    const jobs: JobLite[] = jobRows.map((x) => {
      const params = x.params && typeof x.params === "object" ? (x.params as Record<string, unknown>) : {};
      return {
        id: String(x.id),
        kind: x.kind as JobKind,
        label: jobLabel(String(x.kind), params),
        jumlah: x.kind === "uji" && params.jumlah ? num(params.jumlah) : null,
        status: x.status as JobStatus,
        progress: Math.min(1, Math.max(0, num(x.progress))),
        message: txt(x.message),
        done: num(x.done),
        total: num(x.total),
        run_id: typeof x.run_id === "string" ? x.run_id : null,
        mine: x.created_by === ctx.user.id,
        started_at: txt(x.started_at, 40),
        finished_at: txt(x.finished_at, 40),
        created_at: String(x.created_at),
        updated_at: String(x.updated_at),
      };
    });
    const runs: RunLite[] = ((r.data ?? []) as Record<string, unknown>[]).map((x) => ({
      id: String(x.id),
      job_id: typeof x.job_id === "string" ? x.job_id : null,
      label: txt(x.label, 120),
      rubric_version: txt(x.rubric_version, 40),
      model: txt(x.model, 60),
      effort: txt(x.effort, 20),
      sample_size: num(x.sample_size),
      status: x.status as RunStatus,
      done: num(x.done),
      cost_usd: num(x.cost_usd),
      created_at: String(x.created_at),
      finished_at: txt(x.finished_at, 40),
    }));

    // hasil "cek video" (job video) → tautan ke detail hasil
    const videoJobs = jobs.filter((x) => x.kind === "video").map((x) => x.id);
    const hasil: ArStatus["hasil"] = {};
    if (videoJobs.length) {
      const h = await sb.from("review_results").select("id, job_id, video_id, suggestion, confidence, pipeline_status").in("job_id", videoJobs);
      for (const row of (h.data ?? []) as { id: number; job_id: string; video_id: string; suggestion: Saran | null; confidence: number | null; pipeline_status: string }[])
        hasil[row.job_id] = { id: row.id, video_id: row.video_id, suggestion: row.suggestion, confidence: row.confidence, pipeline_status: row.pipeline_status };
    }
    return { now, workers, jobs, antri: q.count ?? jobs.filter((x) => x.status === "antri").length, runs, hasil, error: null };
  } catch {
    return { ...empty, error: "gagal" };
  }
}
