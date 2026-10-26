/**
 * TIMELINE JSON Studio — satu-satunya format yang dibaca komposisi Remotion `StudioVideo`.
 * Dibuat oleh AI Sutradara (Harley), bisa diedit user (kartu rencana / timeline), lalu dirender.
 * AI TIDAK menulis kode: hanya mengisi data ini, dan `normalizeTimeline` membersihkan / membatasi isinya.
 *
 * Satuan waktu = detik (dibulatkan ke frame saat dirender). Semua teks & angka dari AI dianggap DATA, bukan kode.
 */
import { SFX_BUILTIN, type SfxMeta } from "./sfxMeta";
import { normLexicon, upgradeTeaserSpell, type LexEntry } from "./pronounce";

export const FPS = 30;
export type Ratio = "9:16" | "16:9" | "1:1" | "4:5";

/** ukuran + zona aman (px dari tepi) — 9:16 memberi ruang untuk tombol & caption TikTok/Reels di kanan & bawah */
export const FORMATS: Record<Ratio, { w: number; h: number; label: string; safe: { top: number; right: number; bottom: number; left: number } }> = {
  "9:16": { w: 1080, h: 1920, label: "TikTok / Reels / Shorts", safe: { top: 210, right: 150, bottom: 400, left: 64 } },
  "16:9": { w: 1920, h: 1080, label: "YouTube / presentasi", safe: { top: 64, right: 110, bottom: 96, left: 110 } },
  "1:1": { w: 1080, h: 1080, label: "Feed IG / LinkedIn", safe: { top: 64, right: 64, bottom: 84, left: 64 } },
  "4:5": { w: 1080, h: 1350, label: "Feed IG (potret)", safe: { top: 72, right: 64, bottom: 110, left: 64 } },
};
export const RATIOS = Object.keys(FORMATS) as Ratio[];

export type BrandId = "konten" | "tws" | "custom";
export type FontId = "jakarta" | "inter" | "interTight";
export type Brand = { id: BrandId; name: string; primary: string; accent: string; bg: string; text: string; font: FontId; logo?: string | null };
/**
 * logo bawaan brand preset: gambar di public/ website (dipakai kalau user belum upload logo sendiri).
 * Renderer laptop memetakannya ke <public>/brand/<nama file> (remotion/Root.tsx laptopSrc; voice-worker menyalin filenya).
 */
export const PRESET_LOGOS = { konten: "/konten-logo.png", tws: "/brand/tws-logo.svg" } as const;
/** true kalau src = logo bawaan brand preset (bukan logo upload user) */
export const isPresetLogo = (v: unknown): boolean => v === PRESET_LOGOS.konten || v === PRESET_LOGOS.tws;
export const BRANDS: Record<"konten" | "tws", Brand> = {
  konten: { id: "konten", name: "Konten.com", primary: "#f97316", accent: "#fb8a3c", bg: "#09090b", text: "#fafafa", font: "jakarta", logo: PRESET_LOGOS.konten },
  tws: { id: "tws", name: "TWS", primary: "#2f5ff0", accent: "#3a6bff", bg: "#000000", text: "#ffffff", font: "interTight", logo: PRESET_LOGOS.tws },
};
/** logo bawaan milik brand ini (brand "Lainnya" / custom tidak punya) */
export const presetLogoOf = (id: BrandId): string | null => (id === "custom" ? null : PRESET_LOGOS[id]);
/**
 * logo sah untuk brand ini: logo upload user, atau logo bawaan MILIK brand itu sendiri.
 * Logo bawaan brand lain (mis. logo Konten.com di brand TWS / custom) tidak sah — dibuang normalizeTimeline.
 */
export const logoFitsBrand = (logo: unknown, id: BrandId): boolean => !isPresetLogo(logo) || logo === presetLogoOf(id);
/** true kalau logo brand = logo bawaan milik brand itu sendiri (tidak bisa dilepas: kosong = otomatis logo bawaan lagi) */
export const isOwnPresetLogo = (brand: Pick<Brand, "id" | "logo">): boolean => !!brand.logo && brand.logo === presetLogoOf(brand.id);

export type TransitionKind = "cut" | "fade" | "slide" | "zoom" | "mask" | "whip" | "glitch";
export const TRANSITIONS: TransitionKind[] = ["cut", "fade", "slide", "zoom", "mask", "whip", "glitch"];
export type Dir = "left" | "right" | "up" | "down";
/** transisi MASUK ke adegan ini (adegan sebelumnya tetap tampil di bawahnya selama `dur` detik) */
export type Transition = { kind: TransitionKind; dir?: Dir; dur?: number };

/** layar di dalam mockup HP / laptop — dibuat ulang dari komponen website (bukan screenshot) */
export type ScreenKind = "dashboard" | "hotIssue" | "videoReview" | "chat" | "ai" | "design" | "trainAi" | "studio" | "music" | "report" | "website" | "media";
export const SCREENS: ScreenKind[] = ["dashboard", "hotIssue", "videoReview", "chat", "ai", "design", "trainAi", "studio", "music", "report", "website", "media"];

export type LayoutKind = "kinetic" | "title" | "lowerThird" | "counter" | "chart" | "phone" | "laptop" | "logo" | "split" | "features" | "cta" | "media" | "quote" | "teaser";
export const LAYOUTS: LayoutKind[] = ["kinetic", "title", "lowerThird", "counter", "chart", "phone", "laptop", "logo", "split", "features", "cta", "media", "quote", "teaser"];
/** tata letak yang boleh dipakai AI Sutradara & editor biasa ("teaser" = adegan premium buatan tangan, khusus teaser resmi) */
export const PLAN_LAYOUTS: LayoutKind[] = LAYOUTS.filter((k) => k !== "teaser");

/** adegan premium teaser CS Tracker (components/remotion/studio/teaser) — urutan sesuai cue sheet assets/audio/teaser/cue-sheet.md */
export type TeaserShot = "hook" | "reveal" | "dashboard" | "videoReview" | "chat" | "ai" | "tws" | "trainAi" | "musicReport" | "montage" | "outro";
export const TEASER_SHOTS: TeaserShot[] = ["hook", "reveal", "dashboard", "videoReview", "chat", "ai", "tws", "trainAi", "musicReport", "montage", "outro"];

export type Card = { icon?: string; title: string; desc?: string };
export type Side = { title: string; items?: string[]; tone?: "bad" | "good" | "neutral" };
export type ChartData = { kind: "line" | "bar" | "area"; values: number[]; labels?: string[]; unit?: string; up?: boolean };

/**
 * Isi visual adegan. Semua field opsional kecuali `kind`; yang kosong diisi bawaan yang aman.
 * - kinetic: teks layar (Scene.text) muncul berirama; `emphasis` = kata yang disorot warna brand
 * - title: judul besar (+ kicker kecil di atas, subtitle di bawah)
 * - lowerThird: nama + peran di bagian bawah (di atas media / latar)
 * - counter: angka berjalan from → to (+ prefix/suffix, label)
 * - chart: grafik garis/batang beranimasi
 * - phone / laptop: mockup berisi UI website (`screen`), dengan tilt 3D halus
 * - logo: logo reveal + tagline
 * - split: layar dibagi dua (mis. sebelum vs sesudah)
 * - features: 2–4 kartu fitur
 * - cta: ajakan penutup + tombol
 * - media: klip / gambar upload user (cover, ken burns)
 * - quote: kutipan besar
 * - teaser: adegan premium teaser resmi CS Tracker (`shot`), UI dibuat ulang dari komponen website + kamera virtual
 */
export type Layout = {
  kind: LayoutKind;
  emphasis?: string[];
  style?: "stack" | "punch" | "type";
  title?: string;
  subtitle?: string;
  kicker?: string;
  name?: string;
  role?: string;
  from?: number;
  to?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  chart?: ChartData;
  screen?: ScreenKind;
  items?: string[];
  tilt?: number;
  tagline?: string;
  left?: Side;
  right?: Side;
  cards?: Card[];
  button?: string;
  src?: string | null;
  fit?: "cover" | "contain";
  kenburns?: boolean;
  by?: string;
  shot?: TeaserShot;
};

export type BgKind = "gradient" | "particles" | "solid" | "grid" | "media";
export type Background = { kind: BgKind; colors?: string[]; media?: string | null };

/** SFX di adegan: `at` = detik dari awal adegan saat "pukulan" SFX harus terdengar */
export type SfxCue = { id: string; at: number; gain?: number; on: boolean };

export type MusicLevel = "silent" | "low" | "mid" | "high" | "drop";
export type Camera = "none" | "push" | "pull" | "pan" | "tilt";
export type Ease = "spring" | "smooth" | "overshoot";

export type Scene = {
  id: string;
  /** nama adegan untuk manusia: Hook, Reveal, Dashboard, … */
  name: string;
  /** durasi detik (0,5–20) */
  dur: number;
  /**
   * voice over adegan ini. `spell` = ejaan khusus untuk mesin suara (subtitle tetap pakai `text`).
   * `at` = detik mulai VO dihitung dari awal adegan (opsional, 0..dur; kosong = VO_AT bawaan 0,15 dtk) — mis. teaser
   * memakai waktu target naskah per adegan. Dipakai saat VO dibuat (VoLine.at) & sebagai cadangan subtitle/audio; digeser user di
   * timeline / disusun otomatis (arrangeVo) supaya VO tidak numpuk.
   * `tempo` = kecepatan VO yang diatur sendiri (TEMPO_MIN–TEMPO_MAX × normal, mis. 1,1); kosong = otomatis (adegan teaser dipercepat
   * sendiri kalau kepanjangan). Dipakai saat suara adegan ini dibuat (Edge: rate, laptop: atempo).
   */
  vo: { text: string; spell?: string; at?: number; tempo?: number } | null;
  /** teks di layar, maks ±6–7 kata per baris */
  text: string[];
  /** catatan storyboard (apa yang terlihat) */
  visual: string;
  layout: Layout;
  bg: Background;
  transition: Transition;
  camera: Camera;
  ease: Ease;
  sfx: SfxCue[];
  music: MusicLevel;
  subtitles: boolean;
  /**
   * khusus adegan premium teaser: true = kunci durasi dibuka user (durasi & detik SFX bawaan boleh diubah; animasi tetap dibuat
   * untuk durasi aslinya → bisa terpotong / diam di akhir). Kosong = dikunci di ketukan musik (lihat teaserLock.isLockedTeaser).
   */
  unlocked?: boolean;
};

export type VoiceMode = "bank" | "edge" | "elevenlabs" | "none";
export type EdgeVoice = "id-ID-ArdiNeural" | "id-ID-GadisNeural";
/**
 * `lexicon` = kamus ejaan milik proyek ({from, to}, maks 60): kata yang sering salah dibaca mesin suara → cara bacanya.
 * Ditambah kamus bawaan & dipakai otomatis untuk teks ucapan tiap adegan (lib/studio/pronounce.ts); subtitle tidak berubah.
 */
export type Voice = { mode: VoiceMode; voiceId?: string | null; voiceName?: string; edgeVoice?: EdgeVoice; exaggeration?: number; cfg?: number; lexicon?: LexEntry[] };

/**
 * Musik: `src` = "bed" (trailer bed cadangan dari SFX), "none", atau URL file yang bisa diputar
 * (/api/studio/asset/music/… untuk file repo, /api/studio/file?p=… untuk upload user).
 * `beats` (detik) dari deteksi BPM — dipakai untuk menempel potongan & impact ke ketukan.
 */
export type Music = { src: string; name?: string; bpm?: number | null; beats?: number[] | null; offset?: number; gain?: number; lufs?: number | null };

export type Word = { w: string; s: number; e: number };
/**
 * VO hasil generate per adegan. `src` URL yang bisa diputar. `at` = detik mulai dihitung dari awal adegan. `dur` = panjang file
 * (bisa membawa hening di ujung). `speed` = persen suara dipercepat otomatis supaya pas di jendela adegan teaser (1–30, kosong = tidak).
 * `say` = kunci 8 hex teks + teks ucapan saat suara dibuat (voSayKey, lib/studio/pronounce.ts): beda dengan naskah / kamus ejaan
 * sekarang = suaranya dibuat dari versi lama (perlu "Generate ulang VO"). Kosong = VO lama (tidak diketahui).
 */
export type VoLine = { sceneId: string; src: string; dur: number; at?: number; words?: Word[]; speed?: number; say?: string; tempo?: number };
/**
 * Kecepatan VO yang diatur sendiri per kalimat (× tempo normal). `VoLine.tempo` = kecepatan yang dipakai saat baris itu dibuat
 * (diatur user; kosong = otomatis, lihat `speed`).
 */
export const TEMPO_MIN = 0.85;
export const TEMPO_MAX = 1.3;
export const TEMPOS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3] as const;
/** kecepatan dari data (angka / "1,1") → kelipatan 0,05 di TEMPO_MIN..TEMPO_MAX; selain itu undefined (= otomatis) */
export function normTempo(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, n)) * 20) / 20;
}
/** kecepatan → rate Edge-TTS: 1,1 → "+10%", 0,85 → "-15%", 1 → "+0%" */
export const tempoRate = (f: number): string => {
  const n = Math.round((f - 1) * 100);
  return `${n < 0 ? "-" : "+"}${Math.abs(n)}%`;
};

/** detik mulai VO bawaan dari awal adegan (adegan tanpa `vo.at`) */
export const VO_AT = 0.15;
/**
 * detik mulai VO dari awal adegan: posisi baris VO hasil generate (`line.at`, yang dipakai saat suara & VO lengkap dibuat),
 * lalu offset adegan (`scene.vo.at`), lalu bawaan 0,15 dtk. Timeline lama tanpa keduanya tetap 0,15.
 */
export const voStartOf = (sc: Pick<Scene, "vo"> | null | undefined, line?: Pick<VoLine, "at"> | null): number => line?.at ?? sc?.vo?.at ?? VO_AT;
/** ekor napas sesudah kata terakhir yang masih dihitung bagian ucapan (detik) */
export const VO_SPEECH_PAD = 0.12;
/**
 * Panjang ucapan asli baris VO (detik dari awal baris): akhir kata terakhir + 0,12 dtk kalau ada timestamp kata, selain itu `dur`
 * (tidak pernah lebih dari `dur`). File mp3 Edge-TTS membawa hening ±0,5–1 dtk di ujung — hening itu tidak terdengar, jadi boleh
 * menimpa VO berikutnya / adegan berikutnya. Semua deteksi tabrakan & kelebihan memakai angka ini; audio tetap diputar utuh (`dur`).
 */
export function voSpeechEnd(line: Pick<VoLine, "dur" | "words">): number {
  const d = Math.max(0, Number(line.dur) || 0);
  let last = 0;
  for (const w of line.words ?? []) last = Math.max(last, Number(w?.e) || 0);
  return last > 0 ? Math.min(d, last + VO_SPEECH_PAD) : d;
}
/** jeda aman antara akhir ucapan VO dan mulainya VO adegan sesudahnya (detik) */
export const VO_GAP = 0.1;
/** percepatan otomatis maksimal (persen) untuk VO adegan teaser yang durasinya dikunci di ketukan musik */
export const MAX_SPEEDUP = 30;
/** ekor hening di akhir video (detik) — komposisi StudioVideo = total adegan + ekor ini */
export const TAIL_SEC = 0.5;
export type VoTrack = { jobId?: string | null; engine: "chatterbox" | "pocket" | "edge" | "elevenlabs"; temp: boolean; label?: string; lines: VoLine[]; full?: string | null };

export type Timeline = {
  v: 1;
  title: string;
  ratio: Ratio;
  fps: number;
  brand: Brand;
  /** ringkasan konsep & hook 1,5 detik pertama */
  concept: string;
  hook: string;
  platform: string;
  goal: string;
  mood: string;
  voice: Voice;
  music: Music;
  scenes: Scene[];
  /** VO yang sudah dibuat (diisi setelah generate) */
  vo?: VoTrack | null;
  grain?: boolean;
  vignette?: boolean;
  /** tanpa VO sama sekali (versi musik + SFX + teks) */
  muteVo?: boolean;
  /** sutradara AI proyek ini (kosong = Harley) — lihat `Director` */
  director?: Director;
  /** volume campuran (dB) — lihat `Mix` */
  mix?: Mix;
};

/**
 * Sutradara AI proyek: `hero` = nama hero bawaan (mis. "Harley") atau karakter buatan user "char:<uuid>".
 * `name` = nama tampilan (untuk karakter buatan). `notes` = catatan gaya dari user (maks 20 × 300 huruf, teks biasa) —
 * dikirim ke AI sebagai CATATAN, bukan perintah sistem. Server memeriksa hero sebelum dipakai (route chat).
 */
export type Director = { hero: string; name?: string; notes?: string[] };
/** volume campuran per jalur (dB, -24..+6). Data saja — dipakai mixer audio nanti. */
export type Mix = { musicDb?: number; voDb?: number; sfxDb?: number };

// ---------------------------------------------------------------------------------------------
// Aturan & batas
// ---------------------------------------------------------------------------------------------
export const MAX_SCENES = 16;
export const MIN_DUR = 0.5;
export const MAX_DUR = 20;
export const MAX_TOTAL = 180;
export const MAX_WORDS_PER_LINE = 7;
export const MAX_LINES = 4;
export const DEFAULT_TRANSITION_SEC = 0.4;

/** SFX "keras" — maksimal 2 yang pukulannya berdekatan (±0,25 dtk) */
export const LOUD_CATS = new Set(["boom", "braam", "bass-drop", "impact", "riser", "transisi", "glitch"]);
export const isLoudSfx = (m: Pick<SfxMeta, "cat" | "lufs"> | undefined) => !!m && (LOUD_CATS.has(m.cat) || m.lufs > -14);

/** target loudness per kategori (LUFS) — gain staging sebelum mix akhir ±-14 LUFS */
export const TARGET_LUFS: Record<string, number> = {
  vo: -16,
  music: -18,
  ambience: -26,
  "trailer-pulse": -19,
  boom: -13,
  braam: -14,
  "bass-drop": -13,
  impact: -14,
  riser: -16,
  transisi: -16,
  glitch: -17,
  whoosh: -17,
  ui: -17,
  magic: -16,
  koin: -18,
  foley: -20,
};
export const MUSIC_LEVEL_DB: Record<MusicLevel, number> = { silent: -60, low: -8, mid: -4, high: -1.5, drop: 0 };
/** musik turun segini saat VO bicara */
export const DUCK_DB = -8;

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** volume linear SFX supaya mendekati target kategorinya, tanpa membuat true peak lewat -1 dBTP */
export function sfxGain(m: Pick<SfxMeta, "cat" | "lufs" | "tp">, extraDb = 0): number {
  const target = TARGET_LUFS[m.cat] ?? -17;
  const want = target - m.lufs + extraDb;
  const headroom = -1 - m.tp; // jangan sampai puncak > -1 dBTP
  return dbToGain(Math.max(-40, Math.min(want, headroom, 24)));
}

// ---------------------------------------------------------------------------------------------
// Helper waktu
// ---------------------------------------------------------------------------------------------
export const secToFrames = (s: number, fps = FPS) => Math.max(1, Math.round(s * fps));
export const totalSec = (tl: Pick<Timeline, "scenes">) => tl.scenes.reduce((a, s) => a + s.dur, 0);
export const totalFrames = (tl: Pick<Timeline, "scenes" | "fps">) => tl.scenes.reduce((a, s) => a + secToFrames(s.dur, tl.fps), 0);

/** frame awal tiap adegan (tanpa tumpang tindih; transisi memakai sisa adegan sebelumnya) */
export function sceneStarts(tl: Pick<Timeline, "scenes" | "fps">): number[] {
  const out: number[] = [];
  let f = 0;
  for (const s of tl.scenes) {
    out.push(f);
    f += secToFrames(s.dur, tl.fps);
  }
  return out;
}

/** detik awal tiap adegan */
export const sceneStartSecs = (tl: Pick<Timeline, "scenes" | "fps">) => sceneStarts(tl).map((f) => f / tl.fps);

/** grid ketukan dari BPM (dipakai kalau `beats` hasil deteksi tidak ada) */
export function beatGrid(bpm: number, offset: number, until: number): number[] {
  if (!(bpm > 30 && bpm < 260)) return [];
  const step = 60 / bpm;
  const out: number[] = [];
  for (let t = offset; t <= until + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

export const nearestBeat = (t: number, beats: number[]) => beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0] ?? t);

/**
 * Tempel batas adegan ke ketukan terdekat (maks geser `maxShift` detik) supaya potongan & impact jatuh di ketukan.
 * Durasi adegan disesuaikan, total video ikut berakhir di ketukan terakhir yang dekat — tapi tidak pernah lebih panjang
 * dari total semula / MAX_TOTAL (kalau lewat, normalizeTimeline diam-diam membuang adegan terakhir).
 */
export function snapScenesToBeats<T extends Pick<Timeline, "scenes" | "fps">>(tl: T, beats: number[], maxShift = 0.35): T {
  if (beats.length < 2) return tl;
  // batas dibulatkan ke frame & durasi = selisih batas, jadi pembulatan tidak menumpuk
  const fr = (t: number) => Math.round(t * tl.fps) / tl.fps;
  const cap = Math.floor(Math.min(MAX_TOTAL, totalSec(tl)) * tl.fps + 1e-6) / tl.fps;
  const grid = beats.map(fr);
  const n = tl.scenes.length;
  const bounds = [0];
  let acc = 0;
  tl.scenes.forEach((s, i) => {
    acc += s.dur;
    // tiap batas dicek terhadap batas sebelumnya (yang mungkin sudah digeser) supaya durasi tetap MIN_DUR..MAX_DUR,
    // dan tidak lewat `cap` dikurangi ruang minimal (MIN_DUR) untuk adegan-adegan sesudahnya
    const prev = bounds[bounds.length - 1];
    const hi = fr(cap - MIN_DUR * (n - 1 - i));
    const ok = (t: number) => t - prev >= MIN_DUR - 1e-6 && t - prev <= MAX_DUR + 1e-6 && t <= hi + 1e-6;
    const a = fr(acc);
    const b = nearestBeat(a, grid.filter(ok));
    bounds.push(ok(b) && Math.abs(b - acc) <= maxShift ? b : ok(a) ? a : Math.min(hi, fr(prev + Math.min(MAX_DUR, Math.max(MIN_DUR, s.dur)))));
  });
  const scenes = tl.scenes.map((s, i) => ({ ...s, dur: fr(bounds[i + 1] - bounds[i]) }));
  // timeline aneh (mis. adegan < MIN_DUR) yang tidak muat di `cap` -> biarkan apa adanya daripada menyimpan hasil yang kepanjangan
  if (scenes.some((s) => s.dur < MIN_DUR - 1e-6) || totalSec({ scenes }) > MAX_TOTAL + 1e-6) return tl;
  return { ...tl, scenes };
}

// ---------------------------------------------------------------------------------------------
// Normalisasi output AI / editan user
// ---------------------------------------------------------------------------------------------
const str = (v: unknown, max = 300) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const HEX = /^#[0-9a-f]{3,8}$/i;
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown, max: number, len = 120) => arr(v).map((x) => str(x, len)).filter(Boolean).slice(0, max);
/**
 * URL media hanya boleh dari route Studio sendiri (tidak boleh URL luar sembarangan), atau logo bawaan brand preset (PRESET_LOGOS).
 * `/public/…` dipakai renderer di laptop (voice-worker menyalin file ke folder public sementara).
 */
export const safeMediaSrc = (v: unknown): string | null => {
  const s = str(v, 600);
  if (isPresetLogo(s)) return s;
  return (/^\/api\/studio\/(asset|file)\b/.test(s) || /^\/public\/[\w./-]+$/.test(s)) && !s.includes("..") ? s : null;
};

/** pecah baris teks layar yang kepanjangan jadi potongan ≤ MAX_WORDS_PER_LINE kata */
export function splitScreenText(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const w = l.split(/\s+/).filter(Boolean);
    if (w.length <= MAX_WORDS_PER_LINE) out.push(w.join(" "));
    else {
      const parts = Math.ceil(w.length / MAX_WORDS_PER_LINE);
      const per = Math.ceil(w.length / parts);
      for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per).join(" "));
    }
  }
  return out.filter(Boolean).slice(0, MAX_LINES);
}

let idSeq = 0;
const newId = () => `s${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function normLayout(v: unknown, text: string[]): Layout {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = oneOf(o.kind, LAYOUTS, text.length ? "kinetic" : "title");
  const side = (x: unknown): Side | undefined => {
    const s = (x && typeof x === "object" ? x : null) as Record<string, unknown> | null;
    return s ? { title: str(s.title, 60), items: strs(s.items, 4, 60), tone: oneOf(s.tone, ["bad", "good", "neutral"] as const, "neutral") } : undefined;
  };
  const ch = (o.chart && typeof o.chart === "object" ? o.chart : null) as Record<string, unknown> | null;
  const values = ch ? arr(ch.values).map((x) => num(x, NaN, -1e12, 1e12)).filter(Number.isFinite).slice(0, 24) : [];
  return {
    kind,
    emphasis: strs(o.emphasis, 6, 40),
    style: oneOf(o.style, ["stack", "punch", "type"] as const, "punch"),
    title: str(o.title, 90) || undefined,
    subtitle: str(o.subtitle, 140) || undefined,
    kicker: str(o.kicker, 50) || undefined,
    name: str(o.name, 50) || undefined,
    role: str(o.role, 60) || undefined,
    from: o.from === undefined ? undefined : num(o.from, 0, -1e12, 1e12),
    to: o.to === undefined ? undefined : num(o.to, 0, -1e12, 1e12),
    decimals: o.decimals === undefined ? undefined : Math.round(num(o.decimals, 0, 0, 3)),
    prefix: str(o.prefix, 12) || undefined,
    suffix: str(o.suffix, 16) || undefined,
    label: str(o.label, 80) || undefined,
    chart: values.length >= 2 ? { kind: oneOf(ch?.kind, ["line", "bar", "area"] as const, "line"), values, labels: strs(ch?.labels, 24, 16), unit: str(ch?.unit, 12) || undefined, up: ch?.up === undefined ? values[values.length - 1] >= values[0] : !!ch?.up } : undefined,
    screen: o.screen === undefined ? undefined : oneOf(o.screen, SCREENS, "dashboard"),
    items: strs(o.items, 6, 80),
    tilt: o.tilt === undefined ? undefined : num(o.tilt, 0, -25, 25),
    tagline: str(o.tagline, 90) || undefined,
    left: side(o.left),
    right: side(o.right),
    cards: arr(o.cards)
      .map((c) => {
        const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        return { icon: str(x.icon, 8) || undefined, title: str(x.title, 40), desc: str(x.desc, 90) || undefined };
      })
      .filter((c) => c.title)
      .slice(0, 4),
    button: str(o.button, 40) || undefined,
    src: safeMediaSrc(o.src),
    fit: oneOf(o.fit, ["cover", "contain"] as const, "cover"),
    kenburns: o.kenburns === undefined ? true : !!o.kenburns,
    by: str(o.by, 60) || undefined,
    shot: kind === "teaser" ? oneOf(o.shot, TEASER_SHOTS, "hook") : undefined,
  };
}

export type NormalizeOpts = { extraSfx?: SfxMeta[] };

/** bersihkan & batasi timeline dari AI / editan user. Tidak pernah melempar error — field rusak diganti bawaan. */
export function normalizeTimeline(raw: unknown, opts: NormalizeOpts = {}): Timeline {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ratio = oneOf(o.ratio, RATIOS, "9:16");
  const b = (o.brand && typeof o.brand === "object" ? o.brand : {}) as Record<string, unknown>;
  const brandId = oneOf(b.id, ["konten", "tws", "custom"] as const, "konten");
  const base = brandId === "custom" ? BRANDS.konten : BRANDS[brandId];
  // logo bawaan hanya sah untuk brand pemiliknya (AI sering menyalin objek brand lama saat ganti brand, logo ikut terbawa)
  const upLogo = safeMediaSrc(b.logo);
  const brand: Brand = {
    id: brandId,
    name: str(b.name, 40) || (brandId === "custom" ? "Brand" : base.name),
    primary: color(b.primary, base.primary),
    accent: color(b.accent, base.accent),
    bg: color(b.bg, base.bg),
    text: color(b.text, base.text),
    font: oneOf(b.font, ["jakarta", "inter", "interTight"] as const, base.font),
    // tanpa logo upload: brand preset pakai logo bawaannya (brand "Lainnya" tetap tanpa logo → huruf pertama nama).
    // Logo bawaan brand lain diganti logo bawaan brand ini sendiri (custom: tanpa logo).
    logo: (upLogo && logoFitsBrand(upLogo, brandId) ? upLogo : null) ?? presetLogoOf(brandId),
  };
  const catalog = new Map([...SFX_BUILTIN, ...(opts.extraSfx ?? [])].map((s) => [s.id, s]));
  const seen = new Set<string>();
  let total = 0;
  const scenes: Scene[] = [];
  for (const sv of arr(o.scenes).slice(0, MAX_SCENES)) {
    const s = (sv && typeof sv === "object" ? sv : {}) as Record<string, unknown>;
    const dur = Math.round(num(s.dur, 3, MIN_DUR, MAX_DUR) * FPS) / FPS;
    // toleransi kecil: jumlah durasi per 1/30 detik bisa jadi 180.00000000000003 untuk rencana yang pas 180 detik
    if (total + dur > MAX_TOTAL + 1e-6) break;
    total += dur;
    let id = str(s.id, 40).replace(/[^\w-]/g, "");
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const text = splitScreenText(strs(s.text, 8, 160));
    const voRaw = (s.vo && typeof s.vo === "object" ? s.vo : typeof s.vo === "string" ? { text: s.vo } : null) as Record<string, unknown> | null;
    const voText = voRaw ? str(voRaw.text, 400) : "";
    // offset mulai VO (opsional): angka 0..dur, kosong / bukan angka = bawaan (field tidak disimpan)
    const voAtRaw = voRaw?.at;
    const voAt = voAtRaw === undefined || voAtRaw === null || voAtRaw === "" ? NaN : num(voAtRaw, NaN, 0, dur);
    // ejaan teaser versi lama (pakai strip) → versi baru tanpa strip (hanya kalimat yang persis sama, lihat upgradeTeaserSpell)
    const tempo = normTempo(voRaw?.tempo);
    const vo: Scene["vo"] = voText
      ? { text: voText, spell: upgradeTeaserSpell(str(voRaw?.spell, 400)) || undefined, ...(Number.isFinite(voAt) ? { at: Math.round(voAt * 1000) / 1000 } : {}), ...(tempo !== undefined ? { tempo } : {}) }
      : null;
    const tr = (s.transition && typeof s.transition === "object" ? s.transition : { kind: s.transition }) as Record<string, unknown>;
    const bg = (s.bg && typeof s.bg === "object" ? s.bg : {}) as Record<string, unknown>;
    // SFX: hanya dari katalog, maks 8 per adegan, urut waktu, maks 2 SFX keras berdekatan
    const cues = arr(s.sfx)
      .map((c) => {
        const x = (c && typeof c === "object" ? c : { id: c }) as Record<string, unknown>;
        return { id: str(x.id, 60), at: num(x.at, 0, 0, dur), gain: x.gain === undefined ? undefined : num(x.gain, 0, -24, 12), on: x.on === undefined ? true : !!x.on };
      })
      .filter((c) => catalog.has(c.id))
      .sort((a, b2) => a.at - b2.at)
      .slice(0, 8);
    const loudKept: number[] = [];
    const sfx = cues.filter((c) => {
      if (!isLoudSfx(catalog.get(c.id))) return true;
      const near = loudKept.filter((t) => Math.abs(t - c.at) < 0.25).length;
      if (near >= 2) return false;
      loudKept.push(c.at);
      return true;
    });
    const layout = normLayout(s.layout, text);
    scenes.push({
      id,
      name: str(s.name, 40) || `Adegan ${scenes.length + 1}`,
      dur,
      vo,
      text,
      visual: str(s.visual, 400),
      layout,
      bg: { kind: oneOf(bg.kind, ["gradient", "particles", "solid", "grid", "media"] as const, "gradient"), colors: arr(bg.colors).map((c) => color(c, "")).filter(Boolean).slice(0, 3), media: safeMediaSrc(bg.media) },
      transition: { kind: oneOf(tr.kind, TRANSITIONS, scenes.length ? "slide" : "cut"), dir: oneOf(tr.dir, ["left", "right", "up", "down"] as const, "left"), dur: num(tr.dur, DEFAULT_TRANSITION_SEC, 0.1, 1.2) },
      camera: oneOf(s.camera, ["none", "push", "pull", "pan", "tilt"] as const, "push"),
      ease: oneOf(s.ease, ["spring", "smooth", "overshoot"] as const, "spring"),
      sfx,
      music: oneOf(s.music, ["silent", "low", "mid", "high", "drop"] as const, "mid"),
      subtitles: s.subtitles === undefined ? true : !!s.subtitles,
      // kunci durasi hanya ada di adegan premium teaser; hanya `true` yang disimpan
      ...(layout.kind === "teaser" && s.unlocked === true ? { unlocked: true } : {}),
    });
  }
  if (!scenes.length) scenes.push(...defaultTimeline().scenes);
  const v = (o.voice && typeof o.voice === "object" ? o.voice : {}) as Record<string, unknown>;
  const m = (o.music && typeof o.music === "object" ? o.music : {}) as Record<string, unknown>;
  const mSrc = str(m.src, 600);
  // baris VO tanpa `at` (data lama) mulai di offset adegannya (vo.at) atau bawaan 0,15
  const vo = normVo(o.vo, new Map(scenes.map((s) => [s.id, voStartOf(s)] as const)));
  // kamus ejaan proyek: {from, to} terisi, dibatasi panjang & jumlahnya (normLexicon)
  const lexicon = normLexicon(v.lexicon);
  return {
    v: 1,
    title: str(o.title, 80) || "Video baru",
    ratio,
    fps: FPS,
    brand,
    concept: str(o.concept, 600),
    hook: str(o.hook, 200),
    platform: str(o.platform, 60) || FORMATS[ratio].label,
    goal: str(o.goal, 160),
    mood: str(o.mood, 80),
    voice: {
      mode: oneOf(v.mode, ["bank", "edge", "elevenlabs", "none"] as const, "bank"),
      voiceId: str(v.voiceId, 60) || null,
      voiceName: str(v.voiceName, 60) || undefined,
      edgeVoice: oneOf(v.edgeVoice, ["id-ID-ArdiNeural", "id-ID-GadisNeural"] as const, "id-ID-ArdiNeural"),
      exaggeration: v.exaggeration === undefined ? undefined : num(v.exaggeration, 0.6, 0.25, 1),
      cfg: v.cfg === undefined ? undefined : num(v.cfg, 0.4, 0.1, 1),
      ...(lexicon.length ? { lexicon } : {}),
    },
    music: {
      src: mSrc === "none" || mSrc === "bed" ? mSrc : safeMediaSrc(mSrc) ?? "bed",
      name: str(m.name, 80) || undefined,
      bpm: m.bpm === undefined || m.bpm === null ? null : num(m.bpm, 100, 40, 240),
      beats: Array.isArray(m.beats) ? m.beats.map((x) => num(x, NaN, 0, MAX_TOTAL)).filter(Number.isFinite).slice(0, 2000) : null,
      offset: num(m.offset, 0, 0, 120),
      gain: num(m.gain, 0, -24, 12),
      lufs: m.lufs === undefined || m.lufs === null ? null : num(m.lufs, -14, -40, 0),
    },
    scenes,
    vo,
    grain: o.grain === undefined ? true : !!o.grain,
    vignette: o.vignette === undefined ? true : !!o.vignette,
    muteVo: !!o.muteVo,
    ...normDirectorMix(o),
  };
}

// ---------- sutradara & volume campuran (opsional; field kosong / rusak tidak disimpan) ----------
export const DIRECTOR_NOTES_MAX = 20;
export const DIRECTOR_NOTE_LEN = 300;
export const MIX_MIN_DB = -24;
export const MIX_MAX_DB = 6;
const CHAR_HERO = /^char:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HERO_NAME = /^[A-Za-z][A-Za-z .'-]{0,39}$/;
/** teks biasa satu baris: tag HTML, tanda < > `, karakter kontrol dibuang */
export const plainText = (v: unknown, max: number) =>
  (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
    .replace(/<\/?[a-z!?][^>]*>/gi, " ")
    .replace(/[<>`\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
/** catatan gaya: maks 20 × 300 huruf, teks biasa, tanpa dobel */
export function normNotes(v: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = plainText(x, DIRECTOR_NOTE_LEN);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= DIRECTOR_NOTES_MAX) break;
  }
  return out;
}
/** hero sah secara bentuk: "char:<uuid>" atau nama hero (huruf). Cek hero benar-benar ada dilakukan server chat */
export const isDirectorHero = (v: unknown): v is string => typeof v === "string" && (CHAR_HERO.test(v.trim()) || HERO_NAME.test(v.trim()));
export function normDirector(v: unknown): Director | undefined {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || !isDirectorHero(o.hero)) return undefined;
  const hero = o.hero.trim();
  const name = plainText(o.name, 40);
  const notes = normNotes(o.notes);
  return { hero: CHAR_HERO.test(hero) ? hero.toLowerCase() : hero, ...(name ? { name } : {}), ...(notes.length ? { notes } : {}) };
}
/** dB volume campuran: angka → -24..+6 (0,1 dB); bukan angka → undefined */
export const mixDb = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(Math.min(MIX_MAX_DB, Math.max(MIX_MIN_DB, n)) * 10) / 10 : undefined;
};
export function normMix(v: unknown): Mix | undefined {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return undefined;
  const out: Mix = {};
  for (const k of ["musicDb", "voDb", "sfxDb"] as const) {
    const d = mixDb(o[k]);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length ? out : undefined;
}
function normDirectorMix(o: Record<string, unknown>): Pick<Timeline, "director" | "mix"> {
  const director = normDirector(o.director);
  const mix = normMix(o.mix);
  return { ...(director ? { director } : {}), ...(mix ? { mix } : {}) };
}

/** VO cadangan tanpa penyimpanan server (service role kosong) dikirim sebagai data URL mp3/wav — dibatasi ±1,5 MB per baris */
const MAX_DATA_VO = 2_000_000;
const safeVoSrc = (v: unknown): string | null =>
  typeof v === "string" && /^data:audio\/(mpeg|mp3|wav|x-wav);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_DATA_VO ? v : safeMediaSrc(v);

function normVo(v: unknown, sceneAt: Map<string, number>): VoTrack | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return null;
  const lines = arr(o.lines)
    .map((l) => {
      const x = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const src = safeVoSrc(x.src);
      const words = arr(x.words)
        .map((w) => {
          const y = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
          return { w: str(y.w, 40), s: num(y.s, 0, 0, MAX_DUR * 2), e: num(y.e, 0, 0, MAX_DUR * 2) };
        })
        .filter((w) => w.w)
        .slice(0, 400);
      const sid = str(x.sceneId, 40);
      const speed = Math.round(num(x.speed, 0, 0, 100));
      const say = typeof x.say === "string" && /^[0-9a-f]{8}$/.test(x.say) ? x.say : "";
      const tempo = normTempo(x.tempo);
      const line: VoLine | null =
        src && sceneAt.has(sid)
          ? {
              sceneId: sid,
              src,
              dur: num(x.dur, 1, 0.05, MAX_DUR * 2),
              at: num(x.at, sceneAt.get(sid) ?? VO_AT, 0, MAX_DUR),
              words,
              ...(speed > 0 ? { speed } : {}),
              ...(say ? { say } : {}),
              ...(tempo !== undefined ? { tempo } : {}),
            }
          : null;
      return line;
    })
    .filter((l): l is VoLine => !!l);
  if (!lines.length) return null;
  return {
    jobId: str(o.jobId, 60) || null,
    engine: oneOf(o.engine, ["chatterbox", "pocket", "edge", "elevenlabs"] as const, "edge"),
    temp: o.temp === undefined ? true : !!o.temp,
    label: str(o.label, 80) || undefined,
    lines,
    full: safeMediaSrc(o.full),
  };
}

/** contoh awal (dipakai kalau timeline kosong) */
export function defaultTimeline(): Timeline {
  const brand = BRANDS.konten;
  const mk = (s: Partial<Scene> & Pick<Scene, "name" | "dur" | "layout">): Scene => ({
    id: newId(),
    vo: null,
    text: [],
    visual: "",
    bg: { kind: "gradient" },
    transition: { kind: "slide", dir: "left", dur: DEFAULT_TRANSITION_SEC },
    camera: "push",
    ease: "spring",
    sfx: [],
    music: "mid",
    subtitles: true,
    ...s,
  });
  return {
    v: 1,
    title: "Video baru",
    ratio: "9:16",
    fps: FPS,
    brand,
    concept: "Contoh: kenalkan satu fitur dengan hook kuat, demo singkat, lalu ajakan.",
    hook: "Masih kerja manual?",
    platform: FORMATS["9:16"].label,
    goal: "Kenalkan fitur",
    mood: "energik",
    voice: { mode: "none" },
    music: { src: "bed", bpm: 100, beats: null, offset: 0, gain: 0, lufs: null },
    scenes: [
      mk({ name: "Hook", dur: 2.5, text: ["Masih kerja manual?"], layout: { kind: "kinetic", emphasis: ["manual"] }, transition: { kind: "cut" }, sfx: [{ id: "glitch-tinggi", at: 0, on: true }], music: "low" }),
      mk({ name: "Reveal", dur: 3, text: ["Kenalin: CS Tracker"], layout: { kind: "logo", title: "CS Tracker", tagline: "Kerja lebih cepat, bareng-bareng" }, sfx: [{ id: "riser-blastoff", at: 0, on: true }, { id: "impact-chord", at: 0.1, on: true }], music: "high" }),
      mk({ name: "Demo", dur: 4, text: ["Semua issue rapi otomatis"], layout: { kind: "phone", screen: "dashboard", tilt: 8 }, sfx: [{ id: "swoosh-readout", at: 0.2, on: true }] }),
      mk({ name: "CTA", dur: 3, text: ["Coba sekarang"], layout: { kind: "cta", title: "Coba sekarang", button: "Buka CS Tracker" }, sfx: [{ id: "boom-trailer-1", at: 0.1, on: true }], music: "drop" }),
    ],
    vo: null,
    grain: true,
    vignette: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Subtitle (SRT) & naskah
// ---------------------------------------------------------------------------------------------
const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

/**
 * Timestamp per kata dari mesin suara (ejaan mesin, mis. "si es treker") → kata naskah asli (`text`).
 * Jumlah sama = dipetakan satu-satu. Jumlah beda (gara-gara `spell`) = waktu diinterpolasi sepanjang sumbu kata mesin,
 * jadi tiap kata naskah muncul tepat sekali, berurutan, tanpa kata dobel / hilang.
 */
export function alignWords(eng: Word[], text: string[]): Word[] {
  const M = eng.length;
  const N = text.length;
  if (!M || !N) return eng.map((w) => ({ ...w }));
  if (M === N) return eng.map((w, k) => ({ w: text[k], s: w.s, e: w.e }));
  // posisi p (0..M) di sumbu kata mesin → detik
  const at = (p: number) => {
    const k = Math.min(M - 1, Math.floor(p));
    const w = eng[k];
    return w.s + (w.e - w.s) * Math.min(1, p - k);
  };
  return text.map((w, j) => {
    const s = at((j * M) / N);
    return { w, s, e: j === N - 1 ? Math.max(s, eng[M - 1].e) : Math.max(s, at(((j + 1) * M) / N)) };
  });
}

/** potongan subtitle per adegan: dari timestamp per kata kalau ada, kalau tidak dari perkiraan kecepatan bicara */
export function subtitleCues(tl: Timeline): { s: number; e: number; text: string; scene: number }[] {
  const starts = sceneStartSecs(tl);
  // scene = adegan pemilik VO (bukan adegan tempat potongan mulai: VO yang lebih panjang dari adegannya tetap milik adegan itu)
  const cues: { s: number; e: number; text: string; scene: number }[] = [];
  tl.scenes.forEach((sc, i) => {
    if (!sc.vo?.text || tl.muteVo) return;
    const line = tl.vo?.lines.find((l) => l.sceneId === sc.id);
    const t0 = starts[i] + voStartOf(sc, line);
    const textWords = sc.vo.text.split(/\s+/).filter(Boolean);
    // timestamp per kata dari mesin suara memakai ejaan mesin -> teks subtitle tetap kata asli (alignWords)
    const ws = line?.words?.length
      ? alignWords(line.words, textWords).map((w) => ({ w: w.w, s: t0 + w.s, e: t0 + w.e }))
      : (() => {
          // perkiraan (VO belum dibuat): selesai paling lambat 0,2 dtk sebelum adegan habis, dihitung dari offset adegan kalau ada
          const dur = line?.dur ?? Math.min(Math.max(0.1, sc.dur - (sc.vo.at ?? 0) - 0.2), Math.max(0.6, textWords.length * 0.34));
          return textWords.map((w, k) => ({ w, s: t0 + (k * dur) / textWords.length, e: t0 + ((k + 1) * dur) / textWords.length }));
        })();
    // kelompokkan maks 6 kata / potongan, putus di tanda baca
    let cur: typeof ws = [];
    const flush = () => {
      if (cur.length) cues.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" "), scene: i });
      cur = [];
    };
    for (const w of ws) {
      cur.push(w);
      if (cur.length >= 6 || /[.,!?…]$/.test(w.w)) flush();
    }
    flush();
  });
  return cues;
}

/** SRT diurutkan menurut waktu (VO adegan yang lewat batas bisa mulai setelah VO adegan berikutnya); urutan adegan dipakai kalau waktunya sama */
export const toSrt = (cues: { s: number; e: number; text: string }[]) =>
  cues
    .map((c, k) => ({ c, k }))
    .sort((a, b) => a.c.s - b.c.s || a.k - b.k)
    .map(({ c }, i) => `${i + 1}\n${srtTime(c.s)} --> ${srtTime(Math.max(c.e, c.s + 0.3))}\n${c.text}\n`)
    .join("\n");

/** detik akhir video = total adegan + ekor hening TAIL_SEC (sama dengan durationInFrames komposisi StudioVideo); audio dipotong di sini */
export const videoEndSec = (tl: Pick<Timeline, "scenes" | "fps">): number => (totalFrames(tl) + Math.round(TAIL_SEC * tl.fps)) / tl.fps;

/**
 * Jendela ucapan VO tiap adegan (detik): dari mulai VO adegan itu sampai mulai VO adegan sesudahnya yang punya teks VO
 * (kalau tidak ada: akhir video = total adegan + ekor hening), dikurangi jeda aman VO_GAP. `null` = adegan tanpa teks VO.
 * `voAt(scene)` = detik mulai VO dari awal adegan (bawaan voStartOf; VoPanel memakai offset naskah untuk VO baru).
 */
export function voWindows(tl: Pick<Timeline, "scenes" | "fps">, voAt: (s: Scene) => number = (s) => voStartOf(s)): (number | null)[] {
  const starts = sceneStartSecs(tl);
  const end = videoEndSec(tl);
  const at = tl.scenes.map((s, i) => (s.vo?.text ? starts[i] + voAt(s) : null));
  return at.map((a, i) => {
    if (a === null) return null;
    const next = at.slice(i + 1).find((x): x is number => x !== null) ?? end;
    return Math.max(0, Math.round((next - a - VO_GAP) * 1000) / 1000);
  });
}

/**
 * Persen percepatan Edge-TTS (`rate: "+N%"`) supaya ucapan `speech` detik — diukur pada percepatan `cur` persen — muat di `win` detik:
 * N = ceil(((1 + cur/100) · speech/win − 1) · 100) + 3 (cadangan 3% karena tempo Edge tidak persis sebanding), maks MAX_SPEEDUP.
 * 0 = sudah muat (tidak perlu dipercepat). Hasil selalu > `cur` kecuali sudah mentok di MAX_SPEEDUP.
 */
export function speedupPct(speech: number, win: number, cur = 0): number {
  if (!(speech > win + 1e-3)) return 0;
  if (!(win > 0)) return MAX_SPEEDUP;
  const n = Math.ceil(((1 + cur / 100) * (speech / win) - 1) * 100 - 1e-9) + 3;
  return Math.min(MAX_SPEEDUP, Math.max(cur + 1, n));
}

/**
 * VO adegan yang ucapannya (voSpeechEnd) masih bunyi saat VO adegan sesudahnya mulai (dua suara bersamaan) — terjadi kalau VO lebih panjang dari
 * adegannya dan adegan itu tidak diperpanjang (adegan premium teaser dikunci di ketukan). Aturan baris yang diputar sama dengan
 * planAudio (baris punya src & adegannya masih punya teks VO). `sec` = lama tumpang tindih (detik), `next` = adegan yang VO-nya
 * pertama kali tertabrak. Dipakai VoPanel (peringatan) & ExportPanel; pemanggil yang mengecek VO dimatikan / tidak.
 */
export function voClashes(tl: Pick<Timeline, "scenes" | "fps" | "vo">): { scene: number; next: number; sec: number }[] {
  const starts = sceneStartSecs(tl);
  const spans = tl.scenes.flatMap((sc, i) => {
    const l = tl.vo?.lines.find((x) => x.sceneId === sc.id);
    if (!l?.src || !sc.vo?.text) return [];
    const s = starts[i] + voStartOf(sc, l);
    // ucapan asli (bukan panjang file): hening di ujung mp3 boleh menimpa VO berikutnya
    return [{ i, s, e: s + voSpeechEnd(l) }];
  });
  const out: { scene: number; next: number; sec: number }[] = [];
  for (const a of spans) {
    const hit = spans.filter((b) => b.i > a.i && a.e > b.s + 1e-3).sort((x, y) => x.s - y.s)[0];
    if (hit) out.push({ scene: a.i, next: hit.i, sec: Math.min(a.e, hit.e) - hit.s });
  }
  return out;
}

/**
 * VO yang ucapannya (voSpeechEnd) belum selesai saat video habis (total adegan + ekor hening 0,5 dtk) — planAudio memotong klip
 * di akhir video, jadi ujung kalimatnya hilang. Biasanya VO adegan terakhir (mis. Outro teaser yang durasinya dikunci) yang tetap
 * kepanjangan walau sudah dipercepat maks 30%. Aturan baris yang diputar sama dengan voClashes / planAudio. `sec` = detik ucapan
 * yang terpotong. Dipakai VoPanel & ExportPanel (peringatan merah).
 */
export function voCutoffs(tl: Pick<Timeline, "scenes" | "fps" | "vo">): { scene: number; sec: number }[] {
  const starts = sceneStartSecs(tl);
  const end = videoEndSec(tl);
  return tl.scenes.flatMap((sc, i) => {
    const l = tl.vo?.lines.find((x) => x.sceneId === sc.id);
    if (!l?.src || !sc.vo?.text) return [];
    const s = starts[i] + voStartOf(sc, l);
    const cut = s + voSpeechEnd(l) - Math.max(s, end); // mulai sesudah video habis = seluruh ucapan hilang (planAudio melewatinya)
    return cut > 1e-3 ? [{ scene: i, sec: Math.round(cut * 1000) / 1000 }] : [];
  });
}

/** VO yang mulainya digeser lebih lambat tetap mulai paling lambat segini sebelum adegannya habis (detik) */
export const VO_MIN_IN_SCENE = 0.3;
/** satu VO yang digeser arrangeVo: indeks adegan, detik mulai lama & baru (dari awal adegan) */
export type VoMove = { scene: number; from: number; to: number };

/** isotonic regression (bobot sama, pool-adjacent-violators): urutan naik terdekat (kuadrat terkecil) dari `q` */
function isotonic(q: number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const v of q) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  return blocks.flatMap((b) => new Array<number>(b.n).fill(b.sum / b.n));
}

/**
 * Susun otomatis VO yang masih numpuk (ucapan voSpeechEnd + jeda VO_GAP masih bunyi saat VO berikutnya mulai) atau terpotong di
 * akhir video — langkah terakhir setelah jeda dipadatkan & suara dipercepat maks 30% tetap belum muat. Hanya VO yang terlibat yang
 * bergeser, sesedikit mungkin (jumlah kuadrat geseran terkecil): VO berikutnya mulai sedikit lebih lambat (masih di dalam adegannya,
 * paling lambat VO_MIN_IN_SCENE dtk sebelum adegan habis) dan/atau VO ini mulai lebih awal (tidak sebelum awal adegannya / akhir VO
 * sebelumnya). Durasi adegan & audio tidak berubah; posisi baru disimpan ke `line.at` & `scene.vo.at` (VO lengkap .mp3 dilepas).
 * Kalau tetap tidak muat (VO terlalu panjang untuk ruangnya), sisa tumpang tindih dibiarkan sekecil mungkin — pemanggil melaporkan
 * lewat voClashes / voCutoffs. Aturan baris yang dihitung sama dengan voClashes (punya src & adegannya masih punya teks VO).
 */
export function arrangeVo<T extends Pick<Timeline, "scenes" | "fps" | "vo">>(tl: T): { tl: T; moved: VoMove[] } {
  const lines = tl.vo?.lines;
  if (!lines?.length) return { tl, moved: [] };
  const starts = sceneStartSecs(tl);
  const end = videoEndSec(tl);
  type Sp = { i: number; S: number; at0: number; a0: number; L: number; lo: number; hi: number };
  const sp: Sp[] = [];
  tl.scenes.forEach((sc, i) => {
    const l = lines.find((x) => x.sceneId === sc.id);
    if (!l?.src || !sc.vo?.text) return;
    const at0 = voStartOf(sc, l);
    const S = starts[i];
    sp.push({ i, S, at0, a0: S + at0, L: voSpeechEnd(l), lo: S, hi: S + Math.max(at0, sc.dur - VO_MIN_IN_SCENE) });
  });
  if (!sp.length) return { tl, moved: [] };
  sp.sort((x, y) => x.a0 - y.a0 || x.i - y.i);
  const n = sp.length;
  // VO terakhir harus selesai sebelum video habis (kalau masih bisa: tidak lebih awal dari awal adegannya)
  const last = sp[n - 1];
  last.hi = Math.max(last.lo, Math.min(last.hi, end - last.L));
  // jarak minimal mulai VO k → k+1 = ucapan VO k + jeda. Yang mustahil (rentang mulai tidak cukup) dikurangi seperlunya:
  // sisa tumpang tindih itu yang nanti dilaporkan "tetap tidak muat"
  const d = sp.slice(0, -1).map((x) => x.L + VO_GAP);
  let early = sp[0].lo;
  for (let k = 1; k < n; k++) {
    const want = Math.max(sp[k].lo, early + d[k - 1]);
    if (want > sp[k].hi + 1e-9) d[k - 1] = Math.max(0, sp[k].hi - early);
    early = Math.min(sp[k].hi, Math.max(sp[k].lo, early + d[k - 1]));
  }
  // b_k = a_k − C_k (C = jumlah jarak sebelumnya) → syarat tidak numpuk jadi b naik; rentang mulai jadi batas b yang dibuat naik
  // (maks berjalan dari kiri / min berjalan dari kanan) → solusi = isotonic regression lalu dijepit ke batas (optimal untuk batas naik)
  const C: number[] = [0];
  for (let k = 1; k < n; k++) C.push(C[k - 1] + d[k - 1]);
  const lo = sp.map((x, k) => x.lo - C[k]);
  const hi = sp.map((x, k) => x.hi - C[k]);
  for (let k = 1; k < n; k++) lo[k] = Math.max(lo[k], lo[k - 1]);
  for (let k = n - 2; k >= 0; k--) hi[k] = Math.min(hi[k], hi[k + 1]);
  const y = isotonic(sp.map((x, k) => x.a0 - C[k]));
  const moved: VoMove[] = [];
  const at = new Map<string, number>();
  sp.forEach((x, k) => {
    const b = Math.min(Math.max(y[k], Math.min(lo[k], hi[k])), hi[k]);
    const to = Math.round((b + C[k] - x.S) * 1000) / 1000;
    if (Math.abs(to - x.at0) < 5e-4) return;
    moved.push({ scene: x.i, from: x.at0, to: Math.max(0, to) });
    at.set(tl.scenes[x.i].id, Math.max(0, to));
  });
  if (!moved.length) return { tl, moved };
  moved.sort((a, b) => a.scene - b.scene);
  const vo = tl.vo as VoTrack;
  return {
    tl: {
      ...tl,
      scenes: tl.scenes.map((s) => (at.has(s.id) && s.vo ? { ...s, vo: { ...s.vo, at: at.get(s.id) } } : s)),
      vo: { ...vo, full: null, lines: vo.lines.map((l) => (at.has(l.sceneId) ? { ...l, at: at.get(l.sceneId) } : l)) },
    },
    moved,
  };
}
