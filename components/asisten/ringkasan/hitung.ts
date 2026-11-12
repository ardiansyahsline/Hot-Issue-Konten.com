/**
 * Hitungan kecil halaman Ringkasan (murni, tanpa server/browser API — dipakai server component & harness uji UI).
 * Definisi SAMA dengan review-worker/review_worker/metrik.py (kebenaran_baris, bisa_dinilai, bandingkan_versi).
 */
import type { CondongMetrics, KodeAlasan, Persen, ReviewRun, RunMetrics } from "@/lib/asistenReview";

/** field tambahan dari metrik.py (di luar tipe RunMetrics) — semua opsional, data lama tetap aman */
export type PersenCi = Persen & { ci95?: [number, number] | null };
export type MetrikLengkap = Omit<RunMetrics, "setuju_reviewer" | "setuju_akhir" | "akurasi_tanpa_cek_manusia" | "banding" | "biaya" | "per_campaign"> & {
  setuju_reviewer: PersenCi;
  setuju_akhir: PersenCi;
  akurasi_tanpa_cek_manusia: PersenCi;
  setuju_reviewer_semua?: PersenCi;
  presisi_reject?: PersenCi;
  recall_reject?: PersenCi;
  cakupan?: number | null;
  n_di_luar_video?: number;
  n_tanpa_keputusan?: number;
  banding: RunMetrics["banding"] & { dikuatkan?: number; menunggu?: number };
  biaya: RunMetrics["biaya"] & { n_video_ai?: number; cache_hit_persen?: number | null };
  per_campaign: (RunMetrics["per_campaign"][number] & { brand?: string | null })[];
};

/** baris run untuk halaman (tanpa kolom `sample` yang besar) */
export type RunRingkas = Omit<ReviewRun, "metrics" | "sample_params"> & {
  metrics: Partial<MetrikLengkap> | null;
  sample_params: Record<string, unknown> | null;
};

export const adaMetrik = (m: Partial<MetrikLengkap> | null | undefined): m is MetrikLengkap =>
  !!m && typeof m === "object" && m.versi === 1 && !!m.matriks && !!m.setuju_akhir;

/** metrics.condong ada & bentuknya benar (run lama / worker lama → false → bagian pendapat AI disembunyikan) */
export const adaCondong = (c: Partial<CondongMetrics> | null | undefined): c is CondongMetrics =>
  !!c && typeof c === "object" && c.versi === 1 && !!c.akurasi && !!c.matriks && Array.isArray(c.ambang) && Array.isArray(c.kalibrasi);

const nf1 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export const angka = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : nf0.format(v));
export const persenTeks = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${nf1.format(v)}%`);
export const nilaiPersen = (v: PersenCi | number | null | undefined): number | null =>
  v == null ? null : typeof v === "number" ? v : v.persen ?? null;
export const ciTeks = (p: PersenCi | null | undefined) =>
  p?.ci95 && p.ci95.length === 2 ? `kisaran ${nf1.format(p.ci95[0])}–${nf1.format(p.ci95[1])}%` : null;

/** Rp dari angka rupiah (bukan USD) — "Rp 24" / "Rp 48.331" / "Rp 1,4 jt" */
export function rp(idr: number | null | undefined): string {
  const v = idr ?? 0;
  if (!Number.isFinite(v)) return "–";
  if (v >= 1_000_000) return `Rp ${nf1.format(v / 1_000_000)} jt`;
  return `Rp ${v < 100 ? nf1.format(v) : nf0.format(v)}`;
}
export const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;

export function detik(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v < 60) return `${nf1.format(v)} dtk`;
  const m = Math.floor(v / 60);
  return `${m} mnt ${Math.round(v - m * 60)} dtk`;
}

/** nama tahap pipeline (stage_sec) → awam */
export const TAHAP_LABEL: Record<string, string> = {
  unduh: "Unduh video",
  frame: "Ambil gambar",
  ocr: "Baca teks layar",
  asr: "Dengar ucapan",
  musik: "Cocokkan musik",
  visual: "Cocokkan poster/trailer",
  hakim: "Penilaian AI",
};

export const KODE_LABEL: Record<KodeAlasan, string> = {
  tidak_sesuai_brief: "Konten tidak sesuai brief campaign",
  cta_tidak_ada: "CTA wajib tidak ada",
  followers_kurang: "Followers belum memenuhi syarat",
  engagement_bot: "Engagement mencurigakan / bot",
  link_bio_tidak_ada: "Link di bio belum ada",
  duplikat: "Video duplikat / sudah disubmit",
  tidak_bisa_diakses: "Video tidak bisa diakses",
  lainnya: "Lainnya",
};

// ---------------------------------------------------------------- banding versi rubrik (metrik.bandingkan_versi)
export const BANDING_KUNCI: { kunci: keyof MetrikLengkap; label: string; naikBaik: boolean }[] = [
  { kunci: "setuju_akhir", label: "Setuju dengan hasil akhir (yang diputuskan AI)", naikBaik: true },
  { kunci: "setuju_reviewer", label: "Setuju dengan reviewer (yang diputuskan AI)", naikBaik: true },
  { kunci: "akurasi_tanpa_cek_manusia", label: "Benar tanpa bantuan manusia (dari semua video)", naikBaik: true },
  { kunci: "persen_cek_manusia", label: "Diserahkan ke manusia", naikBaik: false },
  { kunci: "presisi_reject", label: "Kalau AI bilang reject, benar-benar reject", naikBaik: true },
  { kunci: "recall_reject", label: "Video yang seharusnya reject dan tertangkap AI", naikBaik: true },
];

export type BarisBanding = { label: string; lama: number | null; baru: number | null; selisih: number | null; membaik: boolean | null };

const barisBanding = (label: string, a: number | null, b: number | null, naikBaik: boolean): BarisBanding => {
  const selisih = a == null || b == null ? null : Math.round((b - a) * 10) / 10;
  return { label, lama: a, baru: b, selisih, membaik: !selisih ? null : selisih > 0 === naikBaik };
};

export function bandingVersi(lama: Partial<MetrikLengkap>, baru: Partial<MetrikLengkap>): BarisBanding[] {
  const rows = BANDING_KUNCI.map(({ kunci, label, naikBaik }) =>
    barisBanding(label, nilaiPersen(lama[kunci] as PersenCi | number | null | undefined), nilaiPersen(baru[kunci] as PersenCi | number | null | undefined), naikBaik),
  );
  // pendapat AI sendiri — hanya kalau salah satu run punya (run lama tanpa condong → "–")
  const ca = adaCondong(lama.condong) ? lama.condong : null;
  const cb = adaCondong(baru.condong) ? baru.condong : null;
  if (ca || cb) rows.push(barisBanding("Pendapat AI sendiri benar (semua video)", nilaiPersen(ca?.akurasi), nilaiPersen(cb?.akurasi), true));
  return rows;
}

/** baris hasil minimal untuk banding berpasangan (video yang sama di dua run) */
export type BarisPasang = {
  video_id: string;
  pipeline_status: string | null;
  suggestion: string | null;
  human_decision: string | null;
  human_code: string | null;
  appeal: string | null;
  final_truth: string | null;
};
const AR = ["approve", "reject"];
const DI_LUAR = ["followers_kurang", "link_bio_tidak_ada", "duplikat"];
const kebenaran = (r: BarisPasang): string | null => {
  if (r.final_truth && AR.includes(r.final_truth)) return r.final_truth;
  if (!r.human_decision || !AR.includes(r.human_decision)) return null;
  return r.appeal === "dibatalkan" ? (r.human_decision === "approve" ? "reject" : "approve") : r.human_decision;
};
const saranDari = (r: BarisPasang) => (r.suggestion === "approve" || r.suggestion === "reject" ? r.suggestion : "cek_manusia");
const bisaDinilai = (r: BarisPasang) => {
  const t = kebenaran(r);
  if ((r.pipeline_status ?? "ok") !== "ok" || !t) return false;
  return !(r.human_decision === "reject" && t === "reject" && DI_LUAR.includes(r.human_code ?? ""));
};

export type Pasangan = { dibanding: number; sama_benar: number; jadi_benar: number; jadi_salah: number; sama_salah: number; lain: number };

export function bandingPasangan(lama: BarisPasang[], baru: BarisPasang[]): Pasangan {
  const m: Pasangan = { dibanding: 0, sama_benar: 0, jadi_benar: 0, jadi_salah: 0, sama_salah: 0, lain: 0 };
  const peta = new Map(lama.map((r) => [String(r.video_id), r]));
  const sudah = new Set<string>();
  for (const r of baru) {
    const id = String(r.video_id);
    if (sudah.has(id)) continue;
    sudah.add(id);
    const a = peta.get(id);
    if (!a || !bisaDinilai(a) || !bisaDinilai(r)) continue;
    m.dibanding++;
    const ba = saranDari(a) === kebenaran(a);
    const bb = saranDari(r) === kebenaran(r);
    if (ba && bb) m.sama_benar++;
    else if (bb) m.jadi_benar++;
    else if (ba) m.jadi_salah++;
    else if (AR.includes(saranDari(a)) && AR.includes(saranDari(r))) m.sama_salah++;
    else m.lain++;
  }
  return m;
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  proses: "Sedang berjalan",
  selesai: "Selesai",
  gagal: "Gagal",
  batal: "Dibatalkan",
  berhenti_biaya: "Berhenti: batas biaya",
};

/** nama run singkat untuk pilihan */
export function namaRun(r: Pick<RunRingkas, "id" | "label" | "rubric_version" | "sample_size" | "created_at">): string {
  const tgl = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(r.created_at));
  return `${r.rubric_version ?? "?"} · ${r.label?.trim() || `uji ${r.sample_size} video`} · ${tgl}`;
}
