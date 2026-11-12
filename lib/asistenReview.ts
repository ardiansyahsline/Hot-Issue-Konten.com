/**
 * Asisten Review Video (MODE UJI) — tipe & helper bersama website (browser + server). Kontrak: KONTRAK.md §1–§2.
 * Tabel Supabase: migration-23-asisten-review.sql. Data di sini TIDAK pernah memuat nama / username / link clipper:
 * video = id Konten.com + id platform (tanpa username), reviewer = pseudonim "R-xxxxxx".
 * Pemilik perubahan: web-lain (web-hasil boleh menambah tipe lokal di filenya sendiri).
 */

export const AR_TAB = "asisten_review" as const;
export const AR_BASE = "/asisten-review";
export const AR_BUCKET = "asisten-review";

/** sub-halaman (urutan = urutan menu di dalam tab) */
export const AR_PAGES = [
  { href: "/asisten-review", label: "Hasil", icon: "📋" },
  { href: "/asisten-review/ringkasan", label: "Ringkasan", icon: "📊" },
  { href: "/asisten-review/uji", label: "Jalankan uji", icon: "▶️" },
  { href: "/asisten-review/materi", label: "Materi referensi", icon: "🎵" },
] as const;

export type Saran = "approve" | "reject" | "cek_manusia";
export type Keputusan = "approve" | "reject";
export type HasilPoin = "lolos" | "tidak" | "tidak_bisa_dinilai";
export type PipelineStatus = "ok" | "tidak_bisa_diakses" | "gagal" | "dilewati_biaya";
export type Banding = "dibatalkan" | "dikuatkan" | "menunggu";
export type JobKind = "uji" | "video" | "materi" | "sinkron";
export type JobStatus = "antri" | "proses" | "selesai" | "gagal" | "batal";
export type RunStatus = "proses" | "selesai" | "gagal" | "batal" | "berhenti_biaya";
export type MateriKind = "lagu" | "poster" | "trailer" | "lainnya";
export type MateriStatus = "antri_sidik" | "proses" | "siap" | "gagal";
export type CampaignMateriStatus = "belum_dicek" | "proses" | "ada" | "sebagian" | "belum_ada" | "gagal";
export type KodeAlasan =
  | "tidak_sesuai_brief" | "cta_tidak_ada" | "followers_kurang" | "engagement_bot"
  | "link_bio_tidak_ada" | "duplikat" | "tidak_bisa_diakses" | "lainnya";
export type KodeSerah =
  | "keyakinan_rendah" | "identitas_orang" | "materi_belum_ada" | "poin_tidak_bisa_dinilai" | "bukti_kurang"
  | "alasan_tidak_jelas" | "ai_menolak" | "ai_gagal" | "video_tidak_bisa_diakses" | "anggaran_habis" | "data_akun";

/** review_results.checklist[] (KONTRAK.md §5.3) */
export type CekPoin = {
  poin_id: string;
  kategori: string;
  teks: string;
  wajib: boolean;
  hasil: HasilPoin;
  bukti: string;
  bukti_frame?: number[];
  bukti_detik?: number[];
  oleh: "ai" | "kode" | "manusia";
};

export type CocokLagu = {
  material_id: string; nama: string; mulai: number; selesai: number; ref_mulai: number; ref_selesai: number;
  skor: number; faktor_tempo?: number | null; faktor_nada?: number | null; yakin: number;
};
/** review_results.music */
export type HasilMusik = {
  status?: "cocok" | "tidak_cocok" | "tidak_ada_referensi" | "gagal" | "nonaktif";
  mesin?: "panako" | "olaf" | "chroma" | "tidak_ada";
  terbaik?: CocokLagu | null;
  semua?: CocokLagu[];
  demucs?: boolean;
  catatan?: string;
};
/** review_results.visual */
export type HasilVisual = {
  status?: "ada" | "tidak_ada" | "tidak_ada_referensi" | "gagal" | "nonaktif";
  cocok?: { material_id: string; jenis: "poster" | "trailer"; frame_idx: number; detik: number; jarak: number; skor: number }[];
  catatan?: string;
};

/** satu baris review_results */
export type ReviewResult = {
  id: number;
  scope: string;
  run_id: string | null;
  job_id: string | null;
  video_id: string;
  platform: string | null;
  platform_video_id: string | null;
  campaign_id: string | null;
  campaign_title: string | null;
  brand: string | null;
  rubric_version: string | null;
  rubric_hash: string | null;
  model: string | null;
  pipeline_status: PipelineStatus;
  suggestion: Saran | null;
  confidence: number | null;
  official_reason: string | null;
  official_code: KodeAlasan | null;
  specific_reason: string | null;
  handoff_reasons: KodeSerah[];
  checklist: CekPoin[];
  music: HasilMusik;
  visual: HasilVisual;
  meta: { durasi_detik?: number | null; n_hashtag?: number; hashtag_present?: boolean | null; bot_score?: number | null; n_frame?: number; ringkasan?: string };
  human_decision: Keputusan | null;
  human_reason: string | null;
  human_code: KodeAlasan | null;
  reviewer: string | null;
  decided_at: string | null;
  appeal: Banding | null;
  final_truth: Keputusan | null;
  match: boolean | null;
  cost_usd: number;
  tokens: { input?: number; output?: number; cache_read?: number; cache_write_1h?: number; cache_write_5m?: number };
  process_sec: number | null;
  stage_sec: Record<string, number>;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewRun = {
  id: string;
  job_id: string | null;
  label: string | null;
  rubric_version: string | null;
  rubric_hash: string | null;
  model: string | null;
  effort: string | null;
  sample_size: number;
  sample_params: Record<string, unknown>;
  status: RunStatus;
  done: number;
  metrics: RunMetrics | Record<string, never>;
  cost_usd: number;
  report_path: string | null;
  worker: string | null;
  created_by: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

export type ReviewJob = {
  id: string;
  kind: JobKind;
  params: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  message: string | null;
  done: number;
  total: number;
  run_id: string | null;
  worker: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

/** review_workers.info (KONTRAK.md §1.6) */
export type WorkerInfo = {
  status?: "siap" | "uji" | "video" | "materi" | "sinkron" | "menunggu_gpu" | "berhenti_biaya" | "mati";
  job?: string | null;
  versi?: string;
  gpu?: { nama?: string | null; vram_gb?: number | null } | null;
  db?: "ok" | "tidak_terhubung" | "belum_dicek";
  ai?: "ok" | "kunci_kosong" | "gagal";
  musik?: "panako" | "olaf" | "chroma" | "tidak_ada";
  ocr?: "easyocr-gpu" | "easyocr-cpu" | "mati";
  budget?: { usd_hari_ini: number; batas: number };
  rubric_version?: string;
};
export type ReviewWorker = { id: string; last_seen: string; info: WorkerInfo };

export type ReviewMaterial = {
  id: string;
  campaign_id: string;
  kind: MateriKind;
  source: "gdrive" | "manual";
  status: MateriStatus;
  storage_path: string;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  message: string | null;
  created_at: string;
};

export type ReviewCampaign = {
  campaign_id: string;
  title: string | null;
  brand: string | null;
  campaign_status: string | null;
  brief_points: { id: string; kategori: string; teks: string; wajib: boolean; cara_nilai: string }[];
  duration_min: number | null;
  duration_max: number | null;
  materi_status: CampaignMateriStatus;
  materi_message: string | null;
  materi_checked_at: string | null;
  last_seen_at: string;
};

/** review_runs.metrics (KONTRAK.md §6.2) — semua angka persen 0..100 dengan 1 desimal */
export type Persen = { n: number; benar: number; persen: number | null };
export type RunMetrics = {
  versi: 1;
  n_sampel: number;
  n_diproses: number;
  n_tidak_bisa_diakses: number;
  n_gagal: number;
  n_dinilai: number;
  setuju_reviewer: Persen;
  setuju_akhir: Persen;
  akurasi_tanpa_cek_manusia: Persen;
  persen_cek_manusia: number | null;
  matriks: Record<Keputusan, Record<Saran, number>>;
  per_alasan: { code: KodeAlasan; label: string; n: number; ai_reject: number; ai_reject_alasan_sama: number; ai_approve: number; ai_cek: number; di_luar_video: boolean }[];
  per_campaign: { campaign_id: string; title: string | null; n: number; benar: number; salah: number; cek: number; akurasi: number | null }[];
  per_reviewer: { reviewer: string; n: number; setuju: number; persen: number | null }[];
  serah: Record<string, number>;
  banding: { n: number; dibatalkan: number; ai_benar_saat_dibatalkan: number };
  biaya: { total_usd: number; per_video_usd: number; per_video_idr: number; kurs: number; per_hari_idr: number; per_bulan_idr: number; video_per_hari: number; token: { input: number; output: number; cache_read: number; cache_write: number } };
  waktu: { rata_detik: number | null; median_detik: number | null; p90_detik: number | null; per_tahap: Record<string, number> };
  contoh: { benar: number[]; salah: number[] };
};

export const SARAN_LABEL: Record<Saran, string> = { approve: "Approve", reject: "Reject", cek_manusia: "Butuh cek manusia" };
export const HASIL_POIN_LABEL: Record<HasilPoin, string> = { lolos: "Lolos", tidak: "Tidak", tidak_bisa_dinilai: "Tidak bisa dinilai" };
export const SERAH_LABEL: Record<KodeSerah, string> = {
  keyakinan_rendah: "AI kurang yakin",
  identitas_orang: "Perlu mengenali orang (artis/aktor)",
  materi_belum_ada: "Materi referensi belum ada",
  poin_tidak_bisa_dinilai: "Ada poin wajib yang tidak bisa dinilai",
  bukti_kurang: "Bukti AI kurang",
  alasan_tidak_jelas: "Alasan reject tidak jelas",
  ai_menolak: "AI menolak menilai",
  ai_gagal: "AI gagal / kunci kosong",
  video_tidak_bisa_diakses: "Video tidak bisa diakses",
  anggaran_habis: "Batas biaya harian habis",
  data_akun: "Butuh data akun (followers, niche)",
};
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { antri: "Menunggu laptop", proses: "Diproses", selesai: "Selesai", gagal: "Gagal", batal: "Dibatalkan" };

/** laptop dianggap mati kalau detak jantung lebih lama dari ini */
export const WORKER_DEAD_MS = 60_000;

/** akhiran perkiraan sisa di pesan progres (sama dengan review-worker jobctx & lib/studio) */
export const ETA_RE = /\s·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$/;

export type VideoRef = { jenis: "id"; nilai: string } | { jenis: "platform"; platform: "tiktok" | "instagram" | "youtube"; nilai: string };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Teks yang ditempel user (id Konten.com atau link video) → rujukan TANPA username. null = tidak dikenali.
 * - uuid / angka ≤ 12 digit / id pendek → id Konten.com
 * - tiktok.com/@user/video/<19 digit> → {platform tiktok, nilai id} (username dibuang)
 * - instagram.com/(reel|reels|p|tv)/<kode> → instagram; youtube shorts/<id>, watch?v=<id>, youtu.be/<id> → youtube
 * - angka 15-20 digit polos → id video TikTok
 */
export function parseVideoRef(raw: string): VideoRef | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(s)) return { jenis: "id", nilai: s.toLowerCase() };
  if (/^\d{1,12}$/.test(s)) return { jenis: "id", nilai: s };
  if (/^\d{15,20}$/.test(s)) return { jenis: "platform", platform: "tiktok", nilai: s };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|vm|vt)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host.endsWith("tiktok.com")) {
    const i = parts.indexOf("video");
    const id = i >= 0 ? parts[i + 1] : undefined;
    return id && /^\d{8,25}$/.test(id) ? { jenis: "platform", platform: "tiktok", nilai: id } : null;
  }
  if (host.endsWith("instagram.com")) {
    const i = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    const id = i >= 0 ? parts[i + 1] : undefined;
    return id && ID_RE.test(id) ? { jenis: "platform", platform: "instagram", nilai: id } : null;
  }
  if (host === "youtu.be") {
    const id = parts[0];
    return id && ID_RE.test(id) ? { jenis: "platform", platform: "youtube", nilai: id } : null;
  }
  if (host.endsWith("youtube.com")) {
    const id = parts[0] === "shorts" ? parts[1] : u.searchParams.get("v") ?? undefined;
    return id && ID_RE.test(id) ? { jenis: "platform", platform: "youtube", nilai: id } : null;
  }
  return null;
}

/** link untuk membuka video TANPA username (sama dengan review-worker platform.link_publik) */
export function linkVideo(platform: string | null | undefined, vid: string | null | undefined): string | null {
  if (!vid || !ID_RE.test(vid)) return null;
  if (platform === "tiktok") return `https://www.tiktok.com/embed/v2/${vid}`;
  if (platform === "instagram") return `https://www.instagram.com/reel/${vid}/`;
  if (platform === "youtube") return `https://youtu.be/${vid}`;
  return null;
}

/** biaya USD → teks Rupiah ("Rp 23" / "Rp 1,4 jt") */
export function rupiah(usd: number | null | undefined, kurs = 18000): string {
  const v = (usd ?? 0) * kurs;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

/** error Supabase seputar Asisten Review → kalimat awam (pola tabErrorText) */
export function arErrorText(e: { code?: string; message?: string } | null | undefined, fallback = "Gagal. Coba lagi sebentar."): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "42883" || code === "PGRST202" || /schema cache|does not exist/i.test(msg))
    return "Jalankan supabase/migration-23-asisten-review.sql dulu di Supabase (SQL Editor), lalu muat ulang halaman.";
  if (code === "23505" && /uji_waiting/.test(msg)) return "Sudah ada uji yang menunggu laptop. Tunggu selesai atau batalkan dulu.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Akunmu belum diberi akses Asisten Review. Minta admin membukanya.";
  return fallback;
}
