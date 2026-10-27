/**
 * Perkiraan waktu selesai job laptop (voice-worker) untuk Studio — murni (tanpa React / Supabase) supaya bisa diuji di node.
 * - Pesan job boleh diakhiri " · sisa ±40 dtk" / " · sisa ±2 mnt" (kontrak voice-worker: studio_worker/speed.py fmt_left) → parseEta
 *   memisahkan pesan & detiknya; layar menampilkan pesan TANPA akhiran + chip hitung mundur.
 * - Hitung mundur dari `updated_at` job (berubah tiap patch, trigger studio_touch) + sisa → etaLeft / fmtEta. Jam browser yang
 *   meleset dari jam server dikoreksi dari header Date /api/studio/status (noteServerDate → serverNow).
 * - Job yang masih antri: perkiraan dari catatan kecepatan laptop (studio_workers.info.speed = Speed.summary()) → estimateQueued.
 *   Rumusnya SAMA dengan Speed.ratio / Speed.estimate / est_audio_sec di voice-worker/studio_worker/speed.py — ubah keduanya bersamaan.
 * - Status model di laptop (info.models = models.status_brief()) → modelsHint (petunjuk SIAPKAN-MODEL.bat).
 */

// ---------------------------------------------------------------------------------------------
// Pesan job ber-ETA
// ---------------------------------------------------------------------------------------------
/** akhiran ETA di pesan job (kontrak: spasi, titik tengah U+00B7, spasi, "sisa", spasi, "±", angka, spasi, dtk|mnt) */
export const ETA_RE = /\s*·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$/u;

/** pisahkan akhiran " · sisa ±40 dtk" dari pesan job → { sec: 40, text: "pesan" }; tanpa akhiran → { sec: null, text: pesan apa adanya } */
export function parseEta(message: string | null | undefined): { sec: number | null; text: string } {
  const msg = typeof message === "string" ? message : "";
  const m = ETA_RE.exec(msg);
  if (!m) return { sec: null, text: msg.trim() };
  const n = Number(m[1]);
  return { sec: Number.isFinite(n) ? n * (m[2] === "mnt" ? 60 : 1) : null, text: msg.slice(0, m.index).trim() };
}

/** pesan job tanpa akhiran ETA (kosong → `fallback`) */
export const etaText = (message: string | null | undefined, fallback = "") => parseEta(message).text || fallback;

export type EtaJob = { status?: string | null; message?: string | null; updated_at?: string | null };

/**
 * detik tersisa job yang sedang diproses (bisa negatif = lewat perkiraan), dihitung dari `updated_at` + sisa di pesan.
 * null = job tidak sedang diproses / pesannya tanpa ETA. `updated_at` tidak ada → sisa apa adanya (tidak bisa menghitung mundur).
 * `updated_at` di "masa depan" (jam browser terlambat) → dianggap baru saja (tidak pernah lebih dari sisa di pesan).
 */
export function etaLeft(job: EtaJob | null | undefined, nowMs: number): number | null {
  if (!job || (job.status != null && job.status !== "proses")) return null;
  const { sec } = parseEta(job.message);
  if (sec === null) return null;
  const at = typeof job.updated_at === "string" ? Date.parse(job.updated_at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return sec;
  return sec - Math.max(0, (nowMs - at) / 1000);
}

/** chip hitung mundur: "±40 dtk lagi" / "±2 mnt lagi" / "sebentar lagi" (≤ 0); null → "" */
export function fmtEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "";
  const s = Math.ceil(sec);
  if (s <= 0) return "sebentar lagi";
  if (s < 60) return `±${s} dtk lagi`;
  return `±${Math.max(1, Math.round(s / 60))} mnt lagi`;
}

/** teks kasar untuk pembaca layar (berubah jarang: per menit, lalu 30 dtk, lalu "sebentar lagi") — chip per detik tidak dibacakan */
export function etaSpoken(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "";
  if (sec <= 0) return "Perkiraan selesai sebentar lagi";
  if (sec <= 30) return "Perkiraan selesai kurang dari 30 detik lagi";
  if (sec < 60) return "Perkiraan selesai kurang dari 1 menit lagi";
  return `Perkiraan selesai sekitar ${Math.max(1, Math.round(sec / 60))} menit lagi`;
}

/** round() Python (pembulatan setengah ke genap) — supaya fmtLeft sama persis dengan speed.fmt_left */
const pyRound = (x: number) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));

/** "40 dtk" / "2 mnt" — sama dengan speed.fmt_left (di bawah 1 menit dibulatkan ke atas per 5 dtk, minimal 5 dtk) */
export function fmtLeft(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${Math.max(5, Math.ceil(s / 5) * 5)} dtk`;
  return `${pyRound(s / 60)} mnt`;
}

// ---------------------------------------------------------------------------------------------
// Jam server (header Date) — hitung mundur memakai jam yang sama dengan updated_at
// ---------------------------------------------------------------------------------------------
let skewMs = 0;
/**
 * catat jam server dari header Date (resolusi 1 dtk → +0,5 dtk). Selisih ≤ 5 dtk diabaikan (jitter jaringan / pembulatan header);
 * lebih dari itu = jam browser meleset → serverNow() dikoreksi.
 */
export function noteServerDate(dateHeader: string | null | undefined, localMs: number): void {
  const t = typeof dateHeader === "string" ? Date.parse(dateHeader) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(localMs)) return;
  const d = t + 500 - localMs;
  skewMs = Math.abs(d) > 5000 ? d : 0;
}
/** jam "server" menurut browser (ms) */
export const serverNow = (localMs: number = Date.now()) => localMs + skewMs;

// ---------------------------------------------------------------------------------------------
// Perkiraan job antri (sama rumus dengan voice-worker/studio_worker/speed.py)
// ---------------------------------------------------------------------------------------------
/** ±14,5 huruf per detik bicara bahasa Indonesia (speed.CHARS_PER_SEC) */
export const CHARS_PER_SEC = 14.5;
/** detik proses per detik suara kalau belum pernah diukur, 1 versi (speed.PRIOR / PRIOR_OTHER) */
export const SPEED_PRIOR: Record<string, number> = { chatterbox: 4.0, pocket: 1.5 };
export const SPEED_PRIOR_OTHER = 3.0;
/** tambahan waktu per versi ekstra dalam satu batch (speed.BATCH_EXTRA, lainnya 0,5) */
export const BATCH_EXTRA: Record<string, number> = { chatterbox: 0.25, pocket: 1.0 };
export const SPEED_MAX_N = 6;
/** versi per kalimat bila website tidak menentukan (jobs_tts.DEFAULT_TAKES / TAKES di .env bawaan 3), 1–4 */
export const DEFAULT_TAKES = 3;
/** detik muat model kalau mesin belum dipanaskan (warm false) dan laptop belum pernah mencatat lama muatnya (Chatterbox RTX 5050 ±34 dtk) */
export const LOAD_PRIOR: Record<string, number> = { chatterbox: 35, pocket: 8 };
export const LOAD_PRIOR_OTHER = 20;
/** penanda job 🎧 Coba ejaan (sama dengan TRY_PURPOSE di spellTry.ts / jobs_tts.TRY_PURPOSE) → 1 versi per kandidat */
const TRY_PURPOSE = "coba-ejaan";

export type SpeedEngine = { ratio?: Record<string, number> | null; load?: number | null; n?: number | null };
/** studio_workers.info.speed (Speed.summary()) */
export type SpeedInfo = { chars_per_sec?: number | null; engines?: Record<string, SpeedEngine> | null };
/** bagian status worker yang dipakai perkiraan */
export type WorkerEtaInfo = { engine?: string | null; speed?: SpeedInfo | null; warm?: boolean | null };
/**
 * Field opsional dari detak worker baru (studio_workers.info; worker lama tidak mengirimnya → undefined):
 * `speed` = catatan kecepatan mesin suara (Speed.summary(), untuk perkiraan job antri — estimateQueued),
 * `models` = status model di laptop per nama ("siap" / "belum diunduh" / …), `warm` = mesin suara utama sudah dimuat & dipanaskan.
 */
export type StudioWorkerExtra = { speed?: SpeedInfo | null; models?: Record<string, string> | null; warm?: boolean | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** speed / models / warm dari info detak worker (atau dari JSON route status) — bentuk aneh dibuang, bukan bikin crash */
export function workerExtra(o: Record<string, unknown> | null | undefined): StudioWorkerExtra {
  const out: StudioWorkerExtra = {};
  if (!o) return out;
  const sp = obj(o.speed);
  if (sp) {
    // hanya angka yang dipakai perkiraan (maks 8 mesin, rasio per jumlah versi 1–6)
    const engines: Record<string, SpeedEngine> = {};
    for (const [name, raw] of Object.entries(obj(sp.engines) ?? {}).slice(0, 8)) {
      const e = obj(raw);
      if (!e) continue;
      const ratio: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(e.ratio) ?? {})) if (/^[1-6]$/.test(k) && num(v) !== null && (v as number) > 0) ratio[k] = v as number;
      engines[name.slice(0, 24)] = { ratio, load: num(e.load), n: num(e.n) };
    }
    // kosong sama sekali ({}) = belum ada catatan apa pun → dianggap tidak dilaporkan
    if (num(sp.chars_per_sec) !== null || Object.keys(engines).length) out.speed = { chars_per_sec: num(sp.chars_per_sec), engines };
  }
  const m = o.models;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const models: Record<string, string> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 12)) if (typeof v === "string" && v.trim()) models[k.slice(0, 24)] = v.trim().slice(0, 80);
    out.models = models;
  }
  if (typeof o.warm === "boolean") out.warm = o.warm;
  return out;
}

/** perkiraan panjang suara (detik) dari jumlah huruf teks ucapan (speed.est_audio_sec) */
export const estAudioSec = (chars: number, cps: number = CHARS_PER_SEC) => Math.max(0.6, chars / (cps > 0 ? cps : CHARS_PER_SEC));

/** detik proses per detik suara untuk `takes` versi sekaligus (speed.Speed.ratio): hasil ukur → skala dari jumlah versi terdekat → PRIOR */
export function speedRatio(speed: SpeedInfo | null | undefined, engine: string, takes = 1): number {
  const n = Math.max(1, Math.min(SPEED_MAX_N, Math.trunc(takes) || 1));
  const extra = BATCH_EXTRA[engine] ?? 0.5;
  const r = obj(obj(obj(speed)?.engines)?.[engine])?.ratio;
  const known: [number, number][] = [];
  for (const [k, v] of Object.entries(obj(r) ?? {})) {
    const x = num(v);
    if (/^\d+$/.test(k) && x !== null) known.push([Number(k), x]);
  }
  const exact = known.find(([k]) => k === n);
  if (exact) return exact[1];
  if (known.length) {
    // jumlah versi terdekat (min() Python); seri → yang lebih kecil (urutan kunci angka di JS / jsonb), di laptop bisa yang lebih dulu tercatat
    let [k, v] = known[0];
    for (const [k2, v2] of known) if (Math.abs(k2 - n) < Math.abs(k - n)) [k, v] = [k2, v2];
    return (v * (1 + extra * (n - 1))) / (1 + extra * (k - 1));
  }
  return (SPEED_PRIOR[engine] ?? SPEED_PRIOR_OTHER) * (1 + extra * (n - 1));
}

/** jumlah versi per kalimat yang akan dibuat laptop (jobs_tts.norm_settings + is_trial) */
export function jobTakes(settings: Record<string, unknown> | null | undefined): number {
  const s = obj(settings) ?? {};
  if (s.purpose === TRY_PURPOSE) return 1;
  const raw = s.takes;
  const x = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(",", ".")) : NaN;
  return Number.isNaN(x) ? DEFAULT_TAKES : Math.trunc(Math.max(1, Math.min(4, x)));
}

/** jumlah huruf teks ucapan (spell kalau ada, selain itu teks; spasi dirapikan, dihitung per huruf Unicode seperti len() Python) */
const speechChars = (l: { text?: unknown; spell?: unknown }) => {
  const t = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  if (!t(l.text)) return 0; // baris tanpa teks dilewati worker (parse_lines)
  return [...(t(l.spell) || t(l.text))].length;
};

/**
 * Perkiraan detik job suara yang masih ANTRI (setelah mulai dikerjakan): Σ est_audio_sec(huruf) × ratio(mesin, versi), + lama muat
 * model kalau mesin laptop belum dipanaskan (info.warm false). null = laptop belum melaporkan catatan kecepatan (worker lama) /
 * tidak ada kalimat. Mesin = info.engine (mesin yang akan dipakai job berikutnya), bawaan chatterbox.
 */
export function estimateQueued(
  lines: readonly { text?: unknown; spell?: unknown }[] | null | undefined,
  settings: Record<string, unknown> | null | undefined,
  info: WorkerEtaInfo | null | undefined,
): number | null {
  const speed = obj(info?.speed);
  // worker lama (tanpa info.speed) / catatan kosong ({}) → tidak ditebak. Belum pernah mengukur tapi melapor (engines {}) → PRIOR, sama
  // dengan perkiraan worker sendiri
  if (!speed || (num(speed.chars_per_sec) === null && !Object.keys(obj(speed.engines) ?? {}).length)) return null;
  const list = Array.isArray(lines) ? lines.filter((l) => !!obj(l) && speechChars(l) > 0) : [];
  if (!list.length) return null;
  const engine = typeof info?.engine === "string" && info.engine.trim() ? info.engine.trim() : "chatterbox";
  const cps = num(speed.chars_per_sec) ?? CHARS_PER_SEC;
  const ratio = speedRatio(speed as SpeedInfo, engine, jobTakes(settings));
  let sec = 0;
  for (const l of list) sec += estAudioSec(speechChars(l), cps) * ratio;
  if (info?.warm === false) {
    const load = num(obj(obj(speed.engines)?.[engine])?.load);
    sec += load !== null && load > 0 ? load : (LOAD_PRIOR[engine] ?? LOAD_PRIOR_OTHER);
  }
  return sec;
}

/**
 * Perkiraan detik render MP4 yang masih antri: hanya kalau laptop mencatat kecepatan "render" di info.speed
 * (Speed.record("render", detik video, detik proses)) — tanpa catatan itu null (tidak ditebak).
 */
export function estimateRender(videoSec: number, info: WorkerEtaInfo | null | undefined): number | null {
  const r = obj(obj(obj(info?.speed)?.engines)?.render)?.ratio;
  if (!obj(r) || !Object.values(obj(r)!).some((v) => num(v) !== null) || !(videoSec > 0)) return null;
  return videoSec * speedRatio(info!.speed, "render", 1);
}

/** "Antri · perkiraan ±1 mnt setelah mulai" (null → null) */
export const queuedText = (sec: number | null | undefined): string | null =>
  sec === null || sec === undefined || !Number.isFinite(sec) ? null : `Antri · perkiraan ±${fmtLeft(sec)} setelah mulai`;

// ---------------------------------------------------------------------------------------------
// Model di laptop (info.models = models.status_brief())
// ---------------------------------------------------------------------------------------------
/** nama awam model laptop, urut penting (models.missing) */
export const MODEL_NAMES: Record<string, string> = {
  chatterbox: "Mesin suara utama",
  whisper: "Pengecek ucapan",
  deepfilter: "Pembersih suara",
  utmos: "Penilai kealamian",
  pocket: "Mesin suara cadangan",
};
const MODEL_ORDER = ["chatterbox", "whisper", "deepfilter", "utmos", "pocket"];
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * petunjuk kecil kalau ada model yang belum siap di laptop, mis. "Penilai kealamian belum diunduh — jalankan SIAPKAN-MODEL.bat di laptop".
 * Sedang diunduh di latar → "… sedang diunduh di laptop". Semua siap / worker lama (tanpa info.models) → null.
 */
export function modelsHint(models: Record<string, unknown> | null | undefined): string | null {
  const m = obj(models);
  if (!m) return null;
  // "siap" / dimatikan lewat .env (mis. NATURAL_MOS=0) → tidak perlu petunjuk
  const notReady = MODEL_ORDER.filter((k) => {
    const v = typeof m[k] === "string" ? (m[k] as string).trim().toLowerCase() : "";
    return !!v && v !== "siap" && !/^(mati|off|dimatikan|nonaktif|tidak dipakai)\b/.test(v);
  });
  if (!notReady.length) return null;
  const busy = notReady.filter((k) => /unduh|download|proses|menyiapkan/i.test(String(m[k])) && !/belum|gagal/i.test(String(m[k])));
  const missing = notReady.filter((k) => !busy.includes(k));
  const join = (ks: string[]) => {
    const n = ks.map((k, i) => (i ? lowerFirst(MODEL_NAMES[k]) : MODEL_NAMES[k]));
    return n.length > 1 ? `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}` : n[0];
  };
  const parts: string[] = [];
  if (missing.length) parts.push(`${join(missing)} belum diunduh — jalankan SIAPKAN-MODEL.bat di laptop`);
  if (busy.length) parts.push(`${missing.length ? lowerFirst(join(busy)) : join(busy)} sedang diunduh di laptop`);
  const why = notReady.includes("utmos") && notReady.length === 1 ? " Sementara versi terbaik dipilih dari kejelasan ucapan saja." : "";
  return `${parts.join("; ")}.${why}`;
}
