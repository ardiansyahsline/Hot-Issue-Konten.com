/**
 * Perkiraan waktu selesai job laptop (voice-worker) untuk Studio — murni (tanpa React / Supabase) supaya bisa diuji di node.
 * - Pesan job boleh diakhiri " · sisa ±40 dtk" / " · sisa ±2 mnt" (kontrak voice-worker: studio_worker/speed.py fmt_left) → parseEta
 *   memisahkan pesan & detiknya; layar menampilkan pesan TANPA akhiran + chip hitung mundur.
 * - Hitung mundur dari `updated_at` job (berubah tiap patch, trigger studio_touch) + sisa. Worker membulatkan sisa sebelum dikirim
 *   (fmt_left: < 90 dtk per 5 dtk ke atas, ≥ 90 dtk menit bulat), jadi chip menyimpan TENGGAT per job (trackEta) yang hanya digeser
 *   kalau keluar dari pita ketidakpastian pesan baru → tidak naik-turun tiap patch; tampilannya etaView (chip + teks pembaca layar).
 *   Jam browser yang meleset dari jam server dikoreksi dari header Date /api/studio/status (noteServerDate → serverNow).
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

export type EtaJob = { id?: string | null; status?: string | null; message?: string | null; updated_at?: string | null };

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

/**
 * teks kasar untuk pembaca layar — hanya berubah saat angka chip berganti satuan / kelompok: menit (per menit, satuan mnt), lalu
 * "sekitar 1 menit" (60–89 dtk), "kurang dari 1 menit", "kurang dari 30 detik", "sebentar lagi". Chip per detik tidak dibacakan.
 * `unit` "mnt" = pesan worker masih bersatuan menit → tidak pernah turun ke detik.
 */
export function etaSpoken(sec: number | null | undefined, unit: EtaUnit = "dtk"): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "";
  if (sec <= 0) return "Perkiraan selesai sebentar lagi";
  if (unit === "mnt") return `Perkiraan selesai sekitar ${Math.max(1, Math.round(sec / 60))} menit lagi`;
  if (sec <= 30) return "Perkiraan selesai kurang dari 30 detik lagi";
  if (sec < 60) return "Perkiraan selesai kurang dari 1 menit lagi";
  return `Perkiraan selesai sekitar ${Math.max(1, Math.round(sec / 60))} menit lagi`;
}

/** round() Python (pembulatan setengah ke genap) — supaya fmtLeft sama persis dengan speed.fmt_left */
const pyRound = (x: number) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));

/** batas satuan menit di speed.fmt_left: di bawah 90 dtk tetap detik */
export const FMT_MIN_FROM = 90;

/** "40 dtk" / "85 dtk" / "2 mnt" — sama dengan speed.fmt_left (< 90 dtk dibulatkan ke atas per 5 dtk, minimal 5 dtk; lalu menit bulat) */
export function fmtLeft(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  if (s < FMT_MIN_FROM) return `${Math.max(5, Math.ceil(s / 5) * 5)} dtk`;
  return `${pyRound(s / 60)} mnt`;
}

// ---------------------------------------------------------------------------------------------
// Tenggat stabil per job (chip ETA tidak naik-turun tiap patch)
// ---------------------------------------------------------------------------------------------
export type EtaUnit = "dtk" | "mnt";
/** job 'proses' yang updated_at-nya lebih tua dari ini = yatim (laptop mati / internet putus di tengah job) → chip disembunyikan */
export const ETA_ORPHAN_MS = 5 * 60_000;

/**
 * satuan & pita ketidakpastian akhiran ETA pesan job (kontrak speed.fmt_left), dalam detik sejak updated_at:
 * "N dtk" = sisa nyata di (N-5, N] (N = 5 juga mencakup 0, karena sisa 0 tetap dikirim "5 dtk"); "N mnt" = N×60 ± 30 dtk.
 */
export function etaBand(message: string | null | undefined): { sec: number; unit: EtaUnit; lo: number; hi: number } | null {
  const msg = typeof message === "string" ? message : "";
  const m = ETA_RE.exec(msg);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "mnt") return { sec: n * 60, unit: "mnt", lo: Math.max(0, n * 60 - 30), hi: n * 60 + 30 };
  return { sec: n, unit: "dtk", lo: n <= 5 ? 0 : n - 5, hi: n };
}

/**
 * tenggat job yang disimpan chip (ms, jam server): `lo`–`hi` = rentang tenggat yang masih cocok dengan SEMUA pesan job ini sejauh ini
 * (irisan pita ketidakpastiannya; chip menampilkan batas atas `hi` → tidak pernah "sebentar lagi" terlalu dini), `unit` = satuan
 * pesan terakhir, `key` = id job, `at` = updated_at pesan terakhir.
 */
export type EtaTrack = { key: string; lo: number; hi: number; unit: EtaUnit; at: number };

/**
 * tenggat stabil job yang sedang diproses. Pesan pertama → rentang = pitanya (updated_at + (N-5, N] dtk / N×60 ± 30 dtk). Pesan
 * berikutnya (job sama) → rentang diiris dengan pita barunya: tenggat yang masih di dalam pita TIDAK bergeser (dulu tiap patch
 * hitung mundur mulai lagi dari angka bulat → naik-turun), dan makin lama makin tepat. Pita baru di luar rentang (perkiraan worker
 * berubah) → tenggat digeser secukupnya ke tepi pita baru yang terdekat (job molor: "5 dtk" terus → tetap "sebentar lagi").
 * null = bukan job 'proses' / pesan tanpa ETA. updated_at di masa depan (jam browser terlambat) → dianggap sekarang; tidak ada → sekarang.
 */
export function trackEta(prev: EtaTrack | null | undefined, job: EtaJob | null | undefined, nowMs: number): EtaTrack | null {
  if (!job || (job.status != null && job.status !== "proses")) return null;
  const b = etaBand(job.message);
  if (!b) return null;
  const parsed = typeof job.updated_at === "string" ? Date.parse(job.updated_at) : NaN;
  const at = Number.isFinite(parsed) ? Math.min(parsed, nowMs) : nowMs;
  const key = typeof job.id === "string" ? job.id : "";
  let lo = at + b.lo * 1000;
  let hi = at + b.hi * 1000;
  if (prev && prev.key === key && Number.isFinite(prev.lo) && Number.isFinite(prev.hi)) {
    if (prev.hi < lo) hi = lo; // job lebih lama dari perkiraan sebelumnya → geser secukupnya (tepi bawah pita baru)
    else if (prev.lo > hi) lo = hi; // lebih cepat → tepi atas pita baru
    else [lo, hi] = [Math.max(lo, prev.lo), Math.min(hi, prev.hi)]; // cocok → irisan (tenggat lama tetap / makin tepat)
  }
  return { key, lo, hi, unit: b.unit, at };
}

/** tampilan chip dari tenggat: teks chip, teks pembaca layar, sudah lewat tenggat? null = sembunyikan (tidak ada / job yatim > 5 menit) */
export type EtaView = { left: number; text: string; spoken: string; done: boolean; unit: EtaUnit };
export function etaView(track: EtaTrack | null | undefined, nowMs: number): EtaView | null {
  if (!track || !Number.isFinite(nowMs)) return null;
  if (nowMs - track.at > ETA_ORPHAN_MS) return null;
  const left = (track.hi - nowMs) / 1000; // batas atas sisa (sisa nyata ada di antara lo dan hi)
  if (!(left > 0)) return { left: 0, text: "sebentar lagi", spoken: etaSpoken(0), done: true, unit: track.unit };
  if (track.unit === "mnt") {
    // satuan menit: tetap "±N mnt" (tidak turun ke detik) sampai worker sendiri mengirim satuan detik. N = kebalikan pita worker
    // (N mnt ⇔ sisa di (N×60−30, N×60+30]) dari batas atasnya → saat pesan tiba sama dengan N worker, lalu hanya turun
    const n = Math.max(1, Math.ceil((left - 30) / 60));
    return { left, text: `±${n} mnt lagi`, spoken: etaSpoken(n * 60, "mnt"), done: false, unit: "mnt" };
  }
  const s = Math.ceil(left);
  return { left, text: `±${s} dtk lagi`, spoken: etaSpoken(s, "dtk"), done: false, unit: "dtk" };
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
export type WorkerEtaInfo = { engine?: string | null; speed?: SpeedInfo | null; warm?: boolean | null; loading?: boolean | null };
/**
 * Field opsional dari detak worker baru (studio_workers.info; worker lama tidak mengirimnya → undefined):
 * `speed` = catatan kecepatan mesin suara (Speed.summary(), untuk perkiraan job antri — estimateQueued),
 * `models` = status model di laptop per nama ("siap" / "belum diunduh" / …), `warm` = mesin suara yang akan dipakai job berikutnya
 * SUDAH dimuat (keadaan nyata), `loading` = mesin suara sedang disiapkan (dimuat / dipanaskan, atau modelnya masih diunduh di latar).
 */
export type StudioWorkerExtra = { speed?: SpeedInfo | null; models?: Record<string, string> | null; warm?: boolean | null; loading?: boolean | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** speed / models / warm / loading dari info detak worker (atau dari JSON route status) — bentuk aneh dibuang, bukan bikin crash */
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
  if (typeof o.loading === "boolean") out.loading = o.loading;
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
