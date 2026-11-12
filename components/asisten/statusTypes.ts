/** Bentuk data status laptop + antrian (dipakai server loader, route API & komponen browser) */
import type { Condong, JobKind, JobStatus, ReviewWorker, RunStatus, Saran, WorkerInfo } from "@/lib/asistenReview";
import { CONDONG_LABEL, SARAN_LABEL, WORKER_DEAD_MS } from "@/lib/asistenReview";

export type JobLite = {
  id: string;
  kind: JobKind;
  /** teks awam ("Uji 50 video", "Cek video #123") */
  label: string;
  jumlah: number | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  done: number;
  total: number;
  run_id: string | null;
  /** dibuat akun ini (boleh dibatalkan) */
  mine: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RunLite = {
  id: string;
  job_id: string | null;
  label: string | null;
  rubric_version: string | null;
  model: string | null;
  effort: string | null;
  sample_size: number;
  status: RunStatus;
  done: number;
  cost_usd: number;
  created_at: string;
  finished_at: string | null;
};

export type HasilJob = {
  id: number;
  video_id: string;
  suggestion: Saran | null;
  confidence: number | null;
  pipeline_status: string;
  /** pendapat AI sendiri (migration-24; tidak ada kalau kolomnya belum ada) */
  ai_lean?: Condong | null;
  ai_lean_confidence?: number | null;
};

/** teks tautan hasil cek video: "Reject 86%" / "Butuh cek manusia · AI: REJECT 64%" */
export function teksHasilJob(h: HasilJob): string {
  if (h.pipeline_status !== "ok") return "Lihat (tidak bisa diakses)";
  if (!h.suggestion) return "Lihat hasil";
  const saran = `${SARAN_LABEL[h.suggestion]}${typeof h.confidence === "number" ? ` ${h.confidence}%` : ""}`;
  const lean = h.ai_lean === "approve" || h.ai_lean === "reject" ? h.ai_lean : null;
  if (h.suggestion !== "cek_manusia" || !lean) return saran;
  return `${SARAN_LABEL.cek_manusia} · AI: ${CONDONG_LABEL[lean]}${typeof h.ai_lean_confidence === "number" ? ` ${h.ai_lean_confidence}%` : ""}`;
}

export type ArStatus = {
  /** jam server saat data diambil (koreksi jam browser yang meleset) */
  now: string;
  workers: ReviewWorker[];
  jobs: JobLite[];
  antri: number;
  runs: RunLite[];
  /** job video → hasilnya */
  hasil: Record<string, HasilJob>;
  /** kode error kalau gagal dibaca (tabel belum ada / jaringan) */
  error: string | null;
};

/** laptop hidup? detak < 60 dtk (jam sudah dikoreksi), penanda "mati" (tahun 2000) / detak dari masa depan = mati */
export function workerOnline(w: ReviewWorker | null | undefined, nowMs: number): boolean {
  if (!w) return false;
  const t = Date.parse(w.last_seen);
  if (!Number.isFinite(t) || t < Date.parse("2001-01-01T00:00:00Z")) return false;
  if (w.info?.status === "mati") return false;
  return nowMs - t < WORKER_DEAD_MS && t < nowMs + 30_000;
}

/** laptop yang paling baru berdetak (biasanya cuma satu) */
export const latestWorker = (ws: ReviewWorker[]) => ws.slice().sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen))[0] ?? null;

export const WORKER_STATUS_LABEL: Record<NonNullable<WorkerInfo["status"]>, string> = {
  siap: "Siap, menunggu pekerjaan",
  uji: "Sedang menjalankan uji akurasi",
  video: "Sedang mengecek video",
  materi: "Sedang menyiapkan materi referensi",
  sinkron: "Sedang sinkron alasan reject",
  menunggu_gpu: "Menunggu GPU (mesin suara sedang dipakai)",
  berhenti_biaya: "Berhenti: batas biaya harian tercapai",
  mati: "Mati",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  proses: "Berjalan",
  selesai: "Selesai",
  gagal: "Gagal",
  batal: "Dibatalkan",
  berhenti_biaya: "Berhenti (batas biaya)",
};
